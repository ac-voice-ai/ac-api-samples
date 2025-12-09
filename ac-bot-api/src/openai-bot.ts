import {
  BotConversationWebSocket,
  BotApiWebSocket,
  BotActivity,
  BotActivityEventName,
  ProtocolMessage,
  BotToVaicMessageName,
  MediaFormat
} from '@audiocodes/ac-bot-api';
import { IncomingMessage } from 'http';
import { AzureOpenAI, OpenAI } from 'openai';
import dotenv from 'dotenv';
import { PassThrough } from 'stream';
import { OpenAIRealtimeWS } from 'openai/beta/realtime/ws';
import { RealtimeServerEvent } from 'openai/resources/beta/realtime/realtime';

dotenv.config();

const instructions = 'Please speak clearly and naturally, assume all incoming voice is in english and reply in english';
const model = 'gpt-4o-mini-realtime-preview-2024-12-17'
const VAIC = '[vaic]  ';
const OPENAI = '[openai]  ';


class OpenAiBot {
  private azureOpenAI: boolean = false;
  private client: AzureOpenAI | OpenAI;
  private openAiDirectSocket: OpenAIRealtimeWS;
  private audioToUser: PassThrough | undefined;
  private numOfVoiceDeltas = 0;

  /* add these env variables to .env as well
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_API_KEY,
    OPENAI_API_VERSION,
    AZURE_OPENAI_DEPLOYMENT
  */
  constructor(private botConversation: BotConversationWebSocket) {
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      })
    } else {
      if (!process.env.AZURE_OPENAI_ENDPOINT ||
        !process.env.AZURE_OPENAI_API_KEY ||
        !process.env.OPENAI_API_VERSION)
        throw new Error('Missing required environment variables');
      this.azureOpenAI = true;
      this.client = new AzureOpenAI({
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT!
      });
    }
  }

  async init() {
    this.openAiDirectSocket = await this.createOpenAiDirectSocket();
    this.registerVaicEvents();
  }

  async createOpenAiDirectSocket() {
    const openAiDirectSocket = this.azureOpenAI ?
      await OpenAIRealtimeWS.azure(this.client as AzureOpenAI) :
      new OpenAIRealtimeWS({ model: model });

    console.debug(OPENAI, 'OpenAI Realtime WebSocket initialized');
    this.registerOpenAiEvents(openAiDirectSocket);
    await new Promise<void>((resolve, reject) => {
      openAiDirectSocket.once('session.updated', (event) => {
        console.debug(OPENAI, 'session updated!', event.session);
        resolve();
      });
      openAiDirectSocket.once('error', reject);
    });
    return openAiDirectSocket;
  }

  registerVaicEvents() {
    this.botConversation.on('start', () => {
      console.info(VAIC, 'Conversation started');
    });
    this.botConversation.on('activity', (activity: BotActivity) => {
      this.handleActivity(activity);
    });
    this.botConversation.on('end', async (activity) => {
      console.log(VAIC, 'Conversation ended:', activity);
      this.openAiDirectSocket.close();
    });
    this.botConversation.on('userStream', (userAudio, { message }) => {
      console.debug(VAIC, 'User stream started:', message);
      userAudio.on('data', async (chunk: Buffer) => {
        this.openAiDirectSocket.send({
          type: 'input_audio_buffer.append',
          audio: chunk.toString('base64')
        });
      });
      userAudio.on('end', async () => {
        console.debug(VAIC, 'User stream ended');
      });
    });
  }

  registerOpenAiEvents(openAiDirectSocket: OpenAIRealtimeWS) {
    openAiDirectSocket.socket.on('open', () => {
      console.debug(OPENAI, 'Connection opened!');
    });

    openAiDirectSocket.socket.on('error', (error) => {
      console.error(OPENAI, 'Error connecting to OpenAI Realtime WebSocket', error);
    });

    openAiDirectSocket.on('error', (error) => {
      console.error(OPENAI, 'Error in OpenAI Realtime WebSocket', error);
      openAiDirectSocket.close();
    });

    openAiDirectSocket.on('session.created', (event: Extract<RealtimeServerEvent, { type: 'session.created' }>) => {
      console.debug(OPENAI, 'session created!', event.session);
      openAiDirectSocket.send({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          model: model,
          instructions: instructions,
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad'
          }
        }
      });
    });

    openAiDirectSocket.on('response.audio_transcript.done', (event: Extract<RealtimeServerEvent, { type: 'response.audio_transcript.done' }>) => {
      console.debug(OPENAI, `audio transcript complete: ${event.transcript}`);
    });

    openAiDirectSocket.on('response.done', (event: Extract<RealtimeServerEvent, { type: 'response.done' }>) => {
      console.debug(OPENAI, 'Response done:', event);
    });

    openAiDirectSocket.on('conversation.item.input_audio_transcription.completed', (event: Extract<RealtimeServerEvent, { type: 'conversation.item.input_audio_transcription.completed' }>) => {
      console.debug(OPENAI, 'Input audio transcription completed:', event.transcript);
    });

    openAiDirectSocket.on('response.audio.delta', (event: Extract<RealtimeServerEvent, { type: 'response.audio.delta' }>) => {
      if (this.numOfVoiceDeltas === 0)
        console.debug(OPENAI, 'Receiving response from OpenAI Realtime WebSocket');
      this.numOfVoiceDeltas++;
      const audioChunk = Buffer.from(event.delta, 'base64');

      if (!this.audioToUser) {
        this.audioToUser = new PassThrough();
        this.botConversation.playAudio(this.audioToUser, { mediaFormat: MediaFormat.RAW_LINEAR_16_24 });
      }
      this.audioToUser.write(audioChunk);
    });

    openAiDirectSocket.on('response.audio.done', (event: Extract<RealtimeServerEvent, { type: 'response.audio.done' }>) => {
      console.debug(OPENAI, 'Audio response done:', event, `total voice deltas: ${this.numOfVoiceDeltas}`);
      this.numOfVoiceDeltas = 0;

      if (this.audioToUser) {
        this.audioToUser.end();
        delete this.audioToUser;
      }
    });

    openAiDirectSocket.on('input_audio_buffer.committed', (message) => {
      console.debug(OPENAI, 'Input audio buffer committed:', message);
      this.botConversation!.send(BotToVaicMessageName.userStreamSpeechCommitted);
    });

    openAiDirectSocket.socket.on('close', () => {
      console.debug(OPENAI, 'Connection closed!');
      this.botConversation.close();
    });
  }


  handleActivity(activity: BotActivity) {
    console.log(VAIC, 'Received activity:', JSON.stringify(activity));
    if (activity.type === 'event') {
      if (activity.name === BotActivityEventName.start) {
        console.info(VAIC, 'Conversation started', activity);
      }
    }
  }
}

const api = new BotApiWebSocket().listen({
  host:process.env.LISTEN_HOST || '0.0.0.0',
  port: process.env.LISTEN_PORT ? parseInt(process.env.LISTEN_PORT, 10) : 8083,
  token: process.env.ACCESS_TOKEN || 'TOKEN'
}, () => {
  console.info(VAIC, `Bot API listening on port ${api.port}`);
});

api.on('conversation', async (conversation: BotConversationWebSocket, { initiateMessage, request }: { initiateMessage: ProtocolMessage, request: IncomingMessage }) => {
  console.info(VAIC, `New conversation started. caller: ${initiateMessage.caller}`);
  const openAiBot = new OpenAiBot(conversation);
  await openAiBot.init();
});





import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  BotConversationWebSocket,
  BotApiWebSocket,
  BotActivity,
  BotActivityEventName,
  ProtocolMessage,
  BotToVaicMessageName
} from '@audiocodes/ac-bot-api';
import { IncomingMessage } from 'http';
import { AzureOpenAI } from 'openai';
import dotenv from 'dotenv';
import { PassThrough } from 'stream';
import { OpenAIRealtimeWS } from 'openai/beta/realtime/ws';
import { RealtimeServerEvent } from 'openai/resources/beta/realtime/realtime';


dotenv.config();

type OpenAIModel =
  | "gpt-4o-realtime-preview-2024-12-17"
  | "gpt-4o-realtime-preview"
  | "gpt-4o-realtime-preview-2024-10-01"
  | "gpt-4o-realtime-preview-2025-06-03"
  | "gpt-4o-mini-realtime-preview"
  | "gpt-4o-mini-realtime-preview-2024-12-17"
  | undefined;

const defaultModel: OpenAIModel = "gpt-4o-realtime-preview-2024-12-17";
const defaultPrompt = 'Please speak clearly and naturally, assume all incoming voice is in english and reply in english';
const VAIC = '[vaic]  ';
const OPENAI = '[openai]  ';




class OpenAiBot {
  private client: AzureOpenAI;
  private echoBuffer: Buffer[] = [];
  private openAiDirectSocket: Promise<OpenAIRealtimeWS>;
  private linkedToOai: boolean = false;
  private audioToUser: PassThrough | undefined;
  private audioResponseBuffer: Buffer[] = [];



  constructor(private botConversation: BotConversationWebSocket) {
    this.client = new AzureOpenAI({
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT!
    });
    this.openAiDirectSocket = this.createOpenAiDirectSocket();
    this.registerVaicEvents();
  }

  async createOpenAiDirectSocket() {
    const openAiDirectSocket = await OpenAIRealtimeWS.azure(this.client);
    console.debug(OPENAI, 'OpenAI Realtime WebSocket initialized');
    this.registerOpenAiEvents(openAiDirectSocket);
    await new Promise((resolve, reject) => {
      openAiDirectSocket.once('session.updated', resolve);
      openAiDirectSocket.once('error', reject);
    });
    return openAiDirectSocket;
  }

  registerVaicEvents() {
    this.botConversation.on('start', async () => {
      console.info(VAIC, 'Conversation started');
    });
    this.botConversation.on('activity', (activity: BotActivity) => {
      this.handleActivity(activity);
    });
    this.botConversation.on('end', async (activity) => {
      console.log(VAIC, 'Conversation ended:', activity);
      const openAiDirectSocket = await this.openAiDirectSocket;
      openAiDirectSocket.close();
    });
    this.botConversation.on('userStream', (userAudio, { message }) => {
      console.debug(VAIC, 'User stream started:', message);
      userAudio.on('data', async (chunk: Buffer) => {
        const openAiDirectSocket = await this.openAiDirectSocket;
        openAiDirectSocket.send({
          type: 'input_audio_buffer.append',
          audio: chunk.toString('base64')
        });
      });
      userAudio.on('end', async () => {
        console.debug(VAIC, 'User stream ended');
        console.info(VAIC, 'Sending back incoming voice');
        if (this.echoBuffer.length > 0) {
          this.botConversation.playAudio(Readable.from(Buffer.concat(this.echoBuffer)));
          this.echoBuffer = [];
        } else {
          await
            console.warn(VAIC, 'No incoming audio buffer to send back');
        }
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
          model: 'gpt-4o-mini-realtime-preview-2024-12-17',
          instructions: defaultPrompt,
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
    openAiDirectSocket.on('session.updated', (event: Extract<RealtimeServerEvent, { type: 'session.updated' }>) => {
      console.debug(OPENAI, 'session updated!', event.session);
      this.linkedToOai = true;
    });

    openAiDirectSocket.on('response.text.delta', (event: Extract<RealtimeServerEvent, { type: 'response.text.delta' }>) => {
      console.info(OPENAI, 'got text delta from oai', event.delta);
    });

    openAiDirectSocket.on('response.text.done', (event: Extract<RealtimeServerEvent, { type: 'response.text.done' }>) => {
      console.debug(OPENAI, `complete response: ${event.text}`);
    });

    openAiDirectSocket.on('response.done', (event: Extract<RealtimeServerEvent, { type: 'response.done' }>) => {
      console.debug(OPENAI, 'Response done:', event);
    });

    openAiDirectSocket.on('response.audio.delta', (event: Extract<RealtimeServerEvent, { type: 'response.audio.delta' }>) => {
      console.debug(OPENAI, `Received audio delta: `);

      // Save audio delta to buffer
      const audioChunk = Buffer.from(event.delta, 'base64');
      this.audioResponseBuffer.push(audioChunk);

      if (!this.audioToUser) {
        this.audioToUser = new PassThrough();                                          
        this.botConversation.playAudio(this.audioToUser,{ mediaFormat: 'raw/lpcm16_24' });
      }
      this.audioToUser.write(audioChunk);
    });
    openAiDirectSocket.on('response.audio.done', (event: Extract<RealtimeServerEvent, { type: 'response.audio.done' }>) => {
      console.debug('Audio response done:', event);

      // Save the complete audio buffer to a raw file
      if (this.audioResponseBuffer.length > 0) {
        const completeAudioBuffer = Buffer.concat(this.audioResponseBuffer);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `openai-response-${timestamp}.raw`;
        const filepath = path.resolve(process.cwd(), 'src', 'static', filename);

        fsp.writeFile(filepath, completeAudioBuffer)
          .then(() => {
            console.info(OPENAI, `Audio response saved to: ${filepath}`);
          })
          .catch((error) => {
            console.error(OPENAI, `Failed to save audio response: ${error}`);
          });

        // Clear the buffer for next response
        this.audioResponseBuffer = [];
      }

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
      this.linkedToOai = false;
    });
  }


  handleActivity(activity: BotActivity) {
    console.log('Received activity:', JSON.stringify(activity));
    if (activity.type === 'event') {
      if (activity.name === BotActivityEventName.start) {
        console.info('Conversation started', activity);
      }
    }
  }
}

const api = new BotApiWebSocket().listen({
  port: 8083,
  token: process.env.ACCESS_TOKEN || 'TOKEN'
}, () => {
  console.info(`Bot API listening on port ${api.port}`);
});

api.on('conversation', async (conversation: BotConversationWebSocket, { initiateMessage, request }: { initiateMessage: ProtocolMessage, request: IncomingMessage }) => {
  console.info(`New conversation started. caller: ${initiateMessage.caller}`);
  new OpenAiBot(conversation);
});



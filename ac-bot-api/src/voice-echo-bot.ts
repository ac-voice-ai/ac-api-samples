import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  BotConversationWebSocket,
  BotApiWebSocket,
  BotActivity,
  BotActivityEventName,
  ProtocolMessage
} from '@audiocodes/ac-bot-api';

import { IncomingMessage } from 'http';

const welcomeBuffer = Buffer.from(await fsp.readFile(path.resolve(import.meta.dirname, 'static/welcome-prompt-16k.raw')));
const echoTime = 3000; // milliseconds

class VoiceEchoBot {
  private echoBuffer: Buffer[] = [];
  private echoTimer: NodeJS.Timeout | undefined;

  constructor(private botConversation: BotConversationWebSocket) {
    this.botConversation.on('activity', (activity: BotActivity) => {
      this.handleActivity(activity);
    });
    this.botConversation.on('end', (activity) => {
      console.log('Conversation ended:', activity);
      if (this.echoTimer) {
        clearInterval(this.echoTimer);
        delete this.echoTimer;
      }
    });
    this.botConversation.on('userStream', (userAudio, { message }) => {
      console.debug('User stream started:', message);
      this.echoBuffer = [];
      userAudio.on('data', (chunk: Buffer) => {
        this.echoBuffer.push(chunk);
      });
      userAudio.on('end', () => {
        console.debug('User stream ended');
        console.info('Sending back incoming voice');
        clearInterval(this.echoTimer);
        delete this.echoTimer;
        if (this.echoBuffer.length > 0) {
          this.botConversation.playAudio(Readable.from(Buffer.concat(this.echoBuffer)));
          this.echoBuffer = [];
        } else {
          console.warn('No incoming audio buffer to send back');
        }
      });

      this.echoTimer = setInterval(() => {
        if (this.echoBuffer.length > 0) {
          console.info('Sending recognition');
          // recognition should trigger userStreamStop (assuming bargeIn=false)
          this.botConversation.sendRecognition('Echoing back incoming voice', 0.8);
        }
      }, echoTime);
    });
  }

  handleActivity(activity: any) {
    console.log('Received activity:', JSON.stringify(activity));
    if (activity.type === 'event') {
      if (activity.name === BotActivityEventName.start) {
        this.botConversation.playAudio(Readable.from(welcomeBuffer));
      }
    }
  }
}

const api = new BotApiWebSocket().listen({
  port: 8080,
  token: process.env.ACCESS_TOKEN || 'TOKEN'
}, () => {
  console.info(`Bot API listening on port ${api.port}`);
});

api.on('conversation', (conversation: BotConversationWebSocket, { initiateMessage, request }: { initiateMessage: ProtocolMessage, request: IncomingMessage }) => {
  console.info(`New conversation started. caller: ${initiateMessage.caller}`);
  new VoiceEchoBot(conversation);
});

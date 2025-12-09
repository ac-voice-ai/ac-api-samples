import {
  BotConversationWebSocket,
  BotApiWebSocket,
  BotActivity,
  BotActivityEventName,
  BotActivityType
} from '@audiocodes/ac-bot-api';
import dotenv from 'dotenv';
dotenv.config();

class TextEchoBot {
  constructor(private botConversation: BotConversationWebSocket) {
    this.botConversation.on('activity', (activity: BotActivity) => {
      this.handleActivity(activity);
    });
    this.botConversation.on('end', (activity) => {
      console.log('Conversation ended:', activity);
    });
  }

  private handleActivity(activity: BotActivity) {
    console.log('Received activity:', JSON.stringify(activity));
    if (activity.type === 'event') {
      if (activity.name === BotActivityEventName.start) {
        this.botConversation.playTextMessage('Welcome to AudioCodes webSocket Bot! How can I assist you today?');
        return;
      }
    }
    if (activity.type === 'message' && activity.text) {
      const request = activity.text.toLowerCase().replace(/\.$/u, '');
      if (request === 'disconnect') {
        return this.botConversation.sendActivity([{
          type: BotActivityType.event,
          name: BotActivityEventName.hangup
        }]);
      }
      return this.botConversation.playTextMessage(activity.text);
    }
  }
}

const api = new BotApiWebSocket().listen({
  host:process.env.LISTEN_HOST || '0.0.0.0',
  port: process.env.LISTEN_PORT ? parseInt(process.env.LISTEN_PORT, 10) : 8081,
  token: process.env.ACCESS_TOKEN || 'TOKEN'
}, () => {
  console.info(`Bot API listening on port ${api.port}`);
});

api.on('conversation', (conversation: BotConversationWebSocket, { initiateMessage }) => {
  console.info(`New conversation started. caller: ${initiateMessage.caller}`);
  new TextEchoBot(conversation);
});

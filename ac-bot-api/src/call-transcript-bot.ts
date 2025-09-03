import {
  type BotActivity,
  BotActivityEventName,
  BotActivityType,
  BotApiWebSocket,
  type BotConversationWebSocket,
  type EventActivity,
} from '@audiocodes/ac-bot-api';
import fs from 'fs';
import path from 'path';

type conversationLine = { participant: string | undefined, text: string };

class CallTranscriptTextBot {
  conversation: conversationLine[] = [];
  callDetails: Record<string, unknown> | undefined;
  constructor(private botConversation: BotConversationWebSocket) {
    this.botConversation.on('activity', (activity: BotActivity) => {
      this.handleActivity(activity);
    });
    this.botConversation.on('end', () => {
      console.log('Conversation ended.');
      const callTranscript = this.generateCallTranscript();
      // Here you can send callTranscript to the LLM for summarization
      this.saveConversation(callTranscript);
    });

    this.botConversation.on('userStream', () => {
      console.error('Incoming audio stream not supported in text bot');
      return this.botConversation.sendActivity([
        {
          type: BotActivityType.event,
          name: BotActivityEventName.hangup,
          activityParams: {
            hangupReason: 'This bot does not support audio streams.'
          }
        },
      ]);
    });
  }
  generateCallTranscript() {
    let conversationText = `Call Transcript\n`;
    conversationText += `Timestamp: ${new Date().toISOString()}\n`;
    conversationText += `Caller: ${this.callDetails?.caller || 'unknown'}\n`;
    conversationText += `Call Details: ${JSON.stringify(this.callDetails, null, 2)}\n`;
    conversationText += `\n--- Conversation ---\n\n`;

    for (const message of this.conversation) {
      const participant = message.participant || 'Unknown';
      const text = message.text || '';
      conversationText += `[${participant}]: ${text}\n`;
    }

    return conversationText;
  }
  saveConversation(callTranscript: string) {
    if (!this.conversation || this.conversation.length === 0) {
      console.log('No conversation data to save');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const caller = this.callDetails?.caller || 'unknown';
    const filename = `conversation_${caller}_${timestamp}.txt`;
    const conversationsDir = path.join(import.meta.dirname, 'static', 'conversations');

    if (!fs.existsSync(conversationsDir)) {
      fs.mkdirSync(conversationsDir, { recursive: true });
    }

    const filePath = path.join(conversationsDir, filename);


    try {
      fs.writeFileSync(filePath, callTranscript, 'utf8');
      console.log(`Conversation saved to: ${filePath}`);
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }

  private handleActivity(activity: BotActivity) {
    console.log('Received activity:', JSON.stringify(activity));
    if (activity.type === 'event') {
      if (activity.name === BotActivityEventName.start) {
        this.handleStartEvent(activity);
        return;
      }
    }
    if (activity.type === 'message' && activity.text) {
      const request = activity.text.toLowerCase().replace(/\.$/u, '');
      this.conversation.push({ participant: activity.parameters?.participant as string | undefined, text: activity.text });
    }
  }
  handleStartEvent(activity: EventActivity) {
    const activities: BotActivity[] = [];
    this.conversation = [];
    this.callDetails = activity.parameters;
    if (activity.parameters?.participants) {
      const participants = activity.parameters.participants as Record<string, unknown>[];
      for (const part of participants) {
        activities.push({
          type: BotActivityType.event,
          name: BotActivityEventName.startRecognition,
          activityParams: {
            targetParticipant: part.participant,
          },
        });
      }

      this.botConversation.sendActivity(activities);
    } else {
      console.error('No participants found');
      return this.botConversation.sendActivity([
        {
          type: BotActivityType.event,
          name: BotActivityEventName.hangup,
          activityParams: {
            hangupReason: 'This bot summarizes calls, but no participants were found.'
          }
        },
      ]);

    }
  }
}

const api = new BotApiWebSocket().listen({
  port: 8083,
  token: process.env.ACCESS_TOKEN || 'TOKEN',
},
  () => {
    console.info(`Bot API listening on port ${api.port}`);
  });

api.on('conversation', (conversation: BotConversationWebSocket) => {
  console.info(`New conversation started.`);
  new CallTranscriptTextBot(conversation);
},
);

import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { accessToken, listenHost, verifyClientFunc, voiceBotWs } from './auth.js';
import { Activities, BotActivity, BotActivityEventName, BotActivityType, BotToVaicMessageName, ProtocolMessage, VaicToBotMessageName } from './types.js';

dotenv.config();

const defaultMediaFormat = 'raw/lpcm16';



class BotConversation {
  private ended: boolean;
  private webSocket: WebSocket | undefined;
  private convId = '';
  private mediaFormat: string = defaultMediaFormat;
  private caller: string;


  constructor(webSocket: WebSocket, private options: { token: string }) {
    this.webSocket = webSocket;
    webSocket.on('message', async (message) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const msgStr = message.toString();
      if (msgStr.startsWith('{'))
        try {
          await this.onJson(JSON.parse(msgStr));
        } catch (err) {
          console.error('Error parsing JSON message:', msgStr, err);
        }
    });
    webSocket.on('close', () => {
      console.debug('connection closed');
      this.end();
    });
    webSocket.on('error', (err) => {
      console.error('connection error:', err);
      this.end();
    });
  }
  end() {
    if (this.ended)
      return
    this.webSocket?.close();
    this.ended = true;
    delete this.webSocket;
  }
  private async onJson(msgJson: ProtocolMessage) {
    if (msgJson.type !== VaicToBotMessageName.userStreamChunk)
      console.debug('received message:', msgJson.type);
    switch (msgJson.type) {
      case VaicToBotMessageName.sessionInitiate: {
        this.convId = msgJson.conversationId;
        this.caller = msgJson.caller!;
        await this.send(BotToVaicMessageName.sessionAccepted, {
          mediaFormat: this.mediaFormat,
          success: this.options.token === accessToken
        });
        break;
      }
      case VaicToBotMessageName.sessionResume:
        if (msgJson.conversationId === this.convId)
          await this.send(BotToVaicMessageName.sessionAccepted);
        else
          await this.send(BotToVaicMessageName.sessionError, { conversationId: msgJson.conversationId, reason: 'conversation not found' });
        break;
      case VaicToBotMessageName.activities:
        for (const activity of msgJson.activities!)
          await this.handleActivity(activity);
        break;
      case VaicToBotMessageName.sessionEnd:
        this.end();
        break;
      default:
        console.info('handling unknown message:', msgJson.type);
        break;
    }
  }
  handleActivity(activity: any) {
    if (activity.type === 'event') {
      const valStr = activity.value ? `. Value: ${JSON.stringify(activity.value)}` : '';
      console.debug(`got event - ${activity.name}${valStr}`);
      if (activity.name === BotActivityEventName.start) {
        const recognitionString = 'Hi, I am AudioCodes direct text sample bot. You can talk and I will echo it back.';
        return this.sendMessage(recognitionString);
      }
      return Promise.resolve();
    }
    if (activity.type === 'message' && activity.text) {
      console.info('handling activity:', activity.type, 'text:', activity.text);
      const request: string | undefined = (activity.text as string).toLowerCase().replace(/\.$/u, '');
      if (request === 'transfer') {
        return this.sendActivity([{
          type: BotActivityType.event,
          name: BotActivityEventName.transfer,
          activityParams: {
            handoverReason: 'My handover reason',
            transferTarget: '123456789',
            transferReferredByURL: 'sip:456@ac.com',
            transferSipHeaders: [{
              name: 'UUID',
              value: '123456789'
            },
            {
              name: 'Second-Header',
              value: 'Second-Header-Value'
            }]
          }
        }]);
      }
      return this.sendMessage(activity.text);
    }
    return Promise.resolve();
  }
  send(type: string, message?: any) {
    console.info(`sending ${type}: ${JSON.stringify(message)?.slice(0, 150)}`);
    if (this.ended)
      return Promise.reject(new Error('Connection closed'));
    if (this.webSocket!.readyState !== WebSocket.OPEN)
      return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.webSocket!.send(JSON.stringify({
      type,
      ...message
    }), {}, (err) => {
      if (err)
        reject(err);
      else
        resolve();
    }));
  }

  async sendMessage(text: string, params?: Record<string, unknown>) {
    return this.sendActivity({
      type: BotActivityType.message,
      text,
      activityParams: params
    });
  }
  sendActivity(activity: BotActivity | BotActivity[]) {
    const activities: Activities = {
      activities: Array.isArray(activity) ? activity : [activity]
    };
    return this.send('activities', activities);
  }

}


function initWsBot(server: http.Server) {
  const webSockServer = new WebSocketServer({
    perMessageDeflate: false,
    server,
    verifyClient: verifyClientFunc
  });
  webSockServer.on('connection', (webs: WebSocket, request: http.IncomingMessage) => {
    const token = extractToken(request.headers.authorization);
    if (token !== accessToken) {
      console.error('Invalid token');
      webs.close(401, 'Invalid token');
      return;
    }
    new BotConversation(webs, { token });
  });
}
function extractToken(authHeader: string | undefined): string {
  if (!authHeader)
    return '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme.toLowerCase() !== 'bearer')
    return '';

  return token || '';
}

const textBotWsServer = http.createServer();

textBotWsServer.keepAliveTimeout = 30000;
initWsBot(textBotWsServer);
textBotWsServer.listen(
  voiceBotWs, listenHost,
  () => console.info(`AC-Socket-text-Bot Server (Plain) listening on ${voiceBotWs}.`)
);

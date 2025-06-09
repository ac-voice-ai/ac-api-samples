/*
 * Copyright (C) 2024 AudioCodes Ltd.
 */
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import expressWs from 'express-ws';
import ws from 'ws';
import url from 'url';
import parseBearerToken_ from 'parse-bearer-token';
import { accessToken, verifyClientFunc } from './auth.js';
const parseBearerToken = parseBearerToken_.default;

interface Config {
  enableWebsocket?: boolean;
}

const EXPIRY = 60;
const logger = console;

interface CreateConversationResponse {
  activitiesURL: string;
  refreshURL: string;
  disconnectURL: string;
  websocketURL?: string;
  expiresSeconds: number;
}

const port = 8083;


const StartResponse = {
  type: 'message',
  text: 'Welcome'
};

const HangupResponse = [{
  type: 'message',
  text: 'Disconnecting'
}, {
  type: 'Event',
  name: 'hangup',
  activityParams: {
    hangupReason: 'My hangup reason'
  }
}];

function getResponses(activity: any) {
  if (activity.type === 'event' && activity.name === 'start')
    return [StartResponse];
  if (activity.type === 'message' && activity.text === 'disconnect')
    return HangupResponse;
  return Array.isArray(activity) ? activity : [activity];
}

const app = express();
app.use(express.json());
const server = http.createServer(app);

const ews = expressWs(app, server, { wsOptions: { verifyClient: verifyClientFunc } });

server.keepAliveTimeout = 30000;

const conversations = new Map<string, Conversation>();
ews.app.ws('/conversation/:conversationId/websocket', (webs: ws, req: express.Request) => {
  // Validation is done in verifyClientFunc
  const conversation = conversations.get(req.params.conversationId);
  if (!conversation || !conversation.conf.enableWebsocket) {
    logger.error(`Websocket is not enabled for conversation ${conversation}`);
    webs.close();
    return;
  }
  conversation.webSocket = webs;
});

app.use((req, res, next) => {
  const bearerToken = parseBearerToken(req);
  if (bearerToken === accessToken)
    return next();
  logger.error(`Wrong token: ${bearerToken}`);
  return res.sendStatus(401);
});

class Conversation {
  private expiryTimeout: NodeJS.Timeout;
  public webSocket?: ws;

  constructor(private id: string, expiresSeconds: number, public conf: Config) {
    this.setExpiry(expiresSeconds);
  }

  setExpiry(expiresSeconds: number) {
    clearTimeout(this.expiryTimeout);

    this.expiryTimeout = setTimeout(() => {
      logger.error('Conversation ' + this.id + ' expired');
      conversations.delete(this.id);
    }, expiresSeconds * 1000);
  }

  closeWebsocket(delay = 1000) {
    setTimeout(() => {
      this.webSocket?.close();
      delete this.webSocket;
    }, delay);
  }

  end() {
    if (this.webSocket) {
      const endMessage = {
        activities: [{
          type: 'message',
          text: 'Closing websocket',
          id: crypto.randomUUID(),
          timestamp: new Date().toJSON()
        }]
      };
      this.webSocket.send(JSON.stringify(endMessage));
      this.closeWebsocket();
    }
    clearTimeout(this.expiryTimeout);
    conversations.delete(this.id);
  }
}

app.get('/CreateConversation', (_req, res) => res.send({
  type: 'ac-bot-api',
  success: true
}));

app.post('/CreateConversation', async (req, res) => {
  const conversationId = req.body.conversation;
  if (!conversationId) {
    res.status(400).send('Missing conversation ID\n');
    return;
  }
  logger.debug(`New conversation: ${conversationId}`);
  const conf: Config = {
    enableWebsocket: req.query.websocket === 'true'
  };
  conversations.set(conversationId, new Conversation(conversationId, EXPIRY, conf));
  const responseBody: CreateConversationResponse = {
    activitiesURL: `conversation/${conversationId}/activities`,
    refreshURL: `conversation/${conversationId}/refresh`,
    disconnectURL: `conversation/${conversationId}/disconnect`,
    expiresSeconds: EXPIRY
  };
  if (conf.enableWebsocket)
    responseBody.websocketURL = `conversation/${conversationId}/websocket`;
  logger.debug(`Response ${JSON.stringify(responseBody)}`);
  res.json(responseBody);
});

app.post('/conversation/:conversationId/activities', (req, res) => {
  const conversation = conversations.get(req.params.conversationId);
  if (!conversation) {
    res.sendStatus(404);
    return;
  }

  let [activity] = req.body.activities;

  logger.debug(`Received activity: ${JSON.stringify(activity)}`);
  const testHeader = req.headers['automation-test-header'];
  if (testHeader) {
    activity = {
      type: 'message',
      text: `Received test header: ${testHeader}`
    };
  }

  if (activity.type === 'message' && activity.text.startsWith('Close web socket')) {
    conversation.closeWebsocket();
  }

  const responses = getResponses(activity);
  const responsesMap = new Map<number, any[]>();
  for (const response of responses) {
    const delay = response.delay ? response.delay : 0;
    const responseCopy = { ...response };
    delete responseCopy.delay;
    responseCopy.id = crypto.randomUUID();
    responseCopy.timestamp = new Date().toJSON();
    let responsesArr = responsesMap.get(delay);
    if (!responsesArr) {
      responsesArr = [];
      responsesMap.set(delay, responsesArr);
    }
    responsesArr.push(responseCopy);
  };

  let immediateResponseBody = {};
  for (const [delay, responsesArr] of responsesMap.entries()) {
    const responseBody: any = {};

    if (responsesArr.length > 0)
      responseBody.activities = responsesArr;

    if (delay) {
      const strResponse = JSON.stringify(responseBody);
      setTimeout(() => {
        logger.debug(`Sending response ${strResponse} (delayed ${delay}ms)`);
        conversation.webSocket?.send(strResponse);
      }, delay);
    } else {
      immediateResponseBody = responseBody;
    }
  }
  logger.debug(`Sending response ${JSON.stringify(immediateResponseBody)}`);
  res.json(immediateResponseBody);
});

app.post('/conversation/:conversationId/refresh', (req, res) => {
  const conversation = conversations.get(req.params.conversationId);
  if (!conversation) {
    res.sendStatus(404);
    return;
  }
  conversation.setExpiry(EXPIRY);
  const responseBody = {
    expiresSeconds: EXPIRY
  };

  res.json(responseBody);
});

app.post('/conversation/:conversationId/disconnect', (req, res) => {
  const conversation = conversations.get(req.params.conversationId);
  if (!conversation) {
    res.sendStatus(404);
    return;
  }
  conversation.end();
  logger.debug('Conversation disconnected: ' + req.params.conversationId);
  const responseBody = {};

  res.json(responseBody);
});

if (import.meta.url.startsWith('file:')) {
  const modulePath = url.fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    server.listen(port, '0.0.0.0', () => logger.info(`Server listening on ${port}.`));
  }
}

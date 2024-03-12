/* eslint-disable @typescript-eslint/naming-convention */
/*
 * Copyright (C) 2024 AudioCodes Ltd.
 */

import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import http from 'http';
import { setTimeout as sleep } from 'timers/promises';

const logger = console;

const listenHost = '0.0.0.0';
const sttPort = 8040;
const logSent = Boolean(process.env.LOG_SENT);
const logReceived = Boolean(process.env.LOG_RECEIVED);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
http!.globalAgent = new http.Agent({ keepAlive: true });

enum stepType {
  hypothesis = 'hypothesis',
  recognition = 'recognition'
}

interface SttResult {
  type: stepType,
  text: string,
  confidence?: number
}

interface SttScenario {
  [key: string]: SttResult;
}

class SttSession {
  private ended = false;
  constructor(private ws: WebSocket) { }

  send(message: Record<string, unknown>) {
    const msg = JSON.stringify(message);
    if (logSent)
      logger.info('sending: ', msg);
    if (this.ws.readyState !== WebSocket.OPEN)
      return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.ws.send(msg, {}, (err) => {
      if (err)
        reject(err);
      else
        resolve();
    }));
  }

  sendHypothesis(hypoObj: { text: string }) {
    return this.send({
      type: 'hypothesis',
      alternatives:
        [
          { text: hypoObj.text.toLowerCase() }
        ]
    });
  }

  sendRecognition(recObj: SttResult) {
    return this.send({
      type: 'recognition',
      alternatives:
        [
          { text: recObj.text.toLowerCase(), confidence: 0.8355 }
        ]
    });
  }

  async onMessage(message: string) {
    const scenario: SttScenario = {
      3000: {
        type: stepType.hypothesis,
        text: 'This is a'
      },
      4000: {
        type: stepType.hypothesis,
        text: 'This is a test'
      },
      5350: {
        type: stepType.recognition,
        text: 'This is a test message',
        confidence: 0.96887113
      }
    };

    if (message.startsWith('{')) {
      const acApiMsg = JSON.parse(message);
      switch (acApiMsg.type) {
        case 'start':
          await this.send({ type: 'started' });
          await sleep(50);
          break;
        case 'stop':
          await this.send({ type: 'end', reason: 'stopped by client' });
          break;
        case 'end':
          this.ended = true;
          await this.send({ type: 'end', reason: 'ended by client' });
          await sleep(50);
          this.ws.close();
          return;

        default:
          break;
      }
    }
    const scenarioKeys = Object.keys(scenario).map((key) => parseInt(key, 10));
    let lastKey = 0;
    for (const key of scenarioKeys) {
      const obj = scenario[key];
      // eslint-disable-next-line no-await-in-loop
      await sleep(key - lastKey);
      if (this.ended)
        break;
      // eslint-disable-next-line no-await-in-loop
      await (obj.type === stepType.hypothesis ? this.sendHypothesis(obj) : this.sendRecognition(obj));
      lastKey = key;
    }
  }
}

const sttApp = express();
sttApp.use(express.json());
const sttServer = http.createServer(sttApp);
sttServer.keepAliveTimeout = 30000;

const sttWs = new WebSocketServer({
  perMessageDeflate: false,
  server: sttServer
});
sttWs.on('connection', (ws: WebSocket) => {
  const session = new SttSession(ws);
  ws.on('message', async (message, isBinary) => {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const msgStr = message.toString();
    if (logReceived) {
      if (isBinary)
        logger.info('received: ---binary data--- length:', msgStr.length);
      else
        logger.info('received:', msgStr);
    }
    if (isBinary || !msgStr.startsWith('{'))
      return;
    const msgJson = JSON.parse(msgStr);
    if (msgJson.type === 'start') {
      try {
        await session.onMessage(msgStr);
      } catch (err) {
        logger.error(err);
      }
    }
  });
});

sttServer.listen(sttPort, listenHost, () => logger.info(`STT Server is listening on ${sttPort}.`));

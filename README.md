# AudioCodes VoiceAI Connect API Samples

[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

## Description

This repository contains simple servers that can be used as a reference for integrating with
the AudioCodes [VoiceAI Connect](https://techdocs.audiocodes.com/voice-ai-connect/) API.
The servers are written in Typescript.

## APIs

* [Speech-to-Text API](ac-stt-api) \[[API documentation](https://techdocs.audiocodes.com/voice-ai-connect/#VAIG_API/Speech-to-Text.htm)\]:
  A simple server that accepts websocket connections and sends pre-set transcriptions to the client.

### AudioCodes Bot API
* [HTTP Mode](ac-bot-api) \[[API documentation](https://techdocs.audiocodes.com/voice-ai-connect/#VAIG_API/API_1.htm)\]:
  A server that echos incoming messages. It also supports pre-defined replies like "disconnect", which hangs up.

  To use the bot, you need to set the environment variable ACCESS_TOKEN for running the bot, and configure it accordingly in VoiceAI Connect.

  For example, if the token is MyS3cr3tT0k3n, VoiceAI Connect configuration should contain:
  ```json
  {
    "providers": [{
      "name": "my-bot",
      "type": "ac-api",
      "botURL": "http://bot-server:8083/CreateConversation",
      "credentials": {
        "token": "MyS3cr3tT0k3n"
      }
    }]
  }
  ```
* [WebSocket Mode](ac-bot-api) \[[API documentation](https://techdocs.audiocodes.com/voice-ai-connect/#Bot-API/ac-bot-api-mode-websocket.htm)\]:
  A bot that echos incoming voice or text.

  To use the bot, you need to set the environment variable ACCESS_TOKEN for running the bot, and configure it accordingly in VoiceAI Connect.

  BOT_WS_PORT can be configured as well (default is 8050).

  LISTEN_HOST can be configured as well (default is localhost).
  
  the default echo time is five seconds. ecoTime (in milliseconds) can be configured using botUrl search params. i.e http://bot-server:8050/?echoTime=7000 
  
  To activate websocket mode add: `"acBotApiType": "streaming"` to **bot** configuration.

  this sample bot can support direct mode (stream voice directly to bot) or text mode. To activate direct mode add:
  ```json
  {
    "directTTS": true,
    "directSTT": true,
  }
  ```
  to **bot** configuration.

  Basic websocket mode provider configuration:
  ```json
  {
    "providers": [{
      "name": "my-bot",
      "type": "ac-api",
      "botURL": "http://bot-server:8050",
      "credentials": {
        "token": "MyS3cr3tT0k3n"
      }
    }]
  }
  ```

## License

This project is licensed under the [ISC License](LICENSE).

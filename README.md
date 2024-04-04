# AudioCodes VoiceAI Connect API Samples

[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

## Description

This repository contains simple servers that can be used as a reference for integrating with
the AudioCodes [VoiceAI Connect](https://techdocs.audiocodes.com/voice-ai-connect/) API.
The servers are written in Typescript.

## APIs

* [Speech-to-Text API](ac-stt-api) \[[API documentation](https://techdocs.audiocodes.com/voice-ai-connect/#VAIG_API/Speech-to-Text.htm)\]:
  A simple server that accepts websocket connections and sends pre-set transcriptions to the client.
* [Bot API](ac-bot-api) \[[API documentation](https://techdocs.audiocodes.com/voice-ai-connect/#VAIG_API/API_1.htm)\]:
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

## License

This project is licensed under the [ISC License](LICENSE).

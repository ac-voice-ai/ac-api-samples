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

## License

This project is licensed under the [ISC License](LICENSE).

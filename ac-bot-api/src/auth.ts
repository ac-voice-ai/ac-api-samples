import dotenv from 'dotenv';
import parseBearerToken_ from 'parse-bearer-token';
import express from 'express';
const parseBearerToken = parseBearerToken_.default;

dotenv.config();
export const accessToken = process.env.ACCESS_TOKEN || 'TOKEN';

export function verifyClientFunc(info: { origin: string; secure: boolean; req: express.Request }) {
  return parseBearerToken(info.req) === accessToken;
}

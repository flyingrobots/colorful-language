#!/usr/bin/env node

export class ReleasePacketPolicyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleasePacketPolicyError";
    this.code = code;
  }
}

export function validateReleasePacket() {
  return { version: "0.4.0" };
}

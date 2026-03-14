"use strict";

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const [algo, salt, digest] = storedHash.split("$");
  if (algo !== "scrypt" || !salt || !digest) return false;

  const derived = await scrypt(password, salt, KEYLEN);
  const expected = Buffer.from(digest, "hex");
  const received = Buffer.from(derived.toString("hex"), "hex");

  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = {
  hashPassword,
  verifyPassword,
};

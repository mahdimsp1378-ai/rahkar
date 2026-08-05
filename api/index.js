import app, { ready } from '../server/app.js';

let initialized;
export default async function handler(req, res) {
  initialized ||= ready();
  await initialized;
  return app(req, res);
}

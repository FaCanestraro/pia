// Entrypoint serverless para a Vercel. O app Express de backend/server.js
// é usado como handler; em Railway/Render/VPS o server.js sobe sozinho.
import app from "../backend/server.js";

export default function handler(req, res) {
  return app(req, res);
}

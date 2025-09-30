// /api/echo.ts
type Req = any; type Res = any;

export default async function handler(req: Req, res: Res) {
  res.status(200).json({
    method: req.method,
    // show what the function *thinks* the body is
    body: req.body ?? null,
    // show if your secret is available (without leaking it)
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    // a couple headers for sanity
    contentType: req.headers?.['content-type'] || null
  });
}

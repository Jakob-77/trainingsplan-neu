// Login ueber ein signiertes, faelschungssicheres Cookie statt einer Sitzungstabelle.
// Passt besser zu "serverless": es gibt keinen dauerhaft laufenden Prozess, der sich
// Sitzungen merken koennte - das Cookie selbst traegt die (signiert und pruefbare) Information.

const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const SESSION_SECRET = process.env.SESSION_SECRET || "bitte-in-produktion-aendern";
const COOKIE_NAME = "auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 Tage - Login bleibt lange bestehen
const IS_PROD = process.env.NODE_ENV === "production";

function createToken(playerId) {
  return jwt.sign({ playerId }, SESSION_SECRET, { expiresIn: MAX_AGE_SECONDS });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (e) {
    return null;
  }
}

function setAuthCookie(res, playerId) {
  const token = createToken(playerId);
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: IS_PROD, // auf Vercel automatisch https -> true; lokal (http) -> false
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    })
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(COOKIE_NAME, "", {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  );
}

function getPlayerIdFromReq(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifyToken(token);
  return payload ? payload.playerId : null;
}

module.exports = { setAuthCookie, clearAuthCookie, getPlayerIdFromReq };

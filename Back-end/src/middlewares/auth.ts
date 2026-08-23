import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export async function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não enviado" });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Token mal formatado" });
  }

  try {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

    const decoded = jwt.verify(token, secret) as any;

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { city: true },
    });

    if (!user) {
      return res.status(401).json({ error: "Usuário inválido" });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        error: "Usuário não autorizado",
        reason: user.status,
      });
    }

    req.user = {
      id: user.id,
      name: user.nome,
      email: user.email,
      role: user.role,
      status: user.status,
      cityId: user.cityId,
      city: user.city
        ? {
            id: user.city.id,
            name: user.city.name,
            state: user.city.state,
          }
        : null,
    };

    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token expirado" });
    }

    return res.status(401).json({ error: "Token inválido" });
  }
}

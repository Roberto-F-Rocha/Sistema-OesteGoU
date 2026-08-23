import { prisma } from "../lib/prisma";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

function allowedCityIds(req): number[] {
  return req.allowedCities ?? (req.user?.cityId ? [req.user.cityId] : []);
}

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listUniversities(req, res) {
  const cityIds = allowedCityIds(req);
  if (!req.user?.cityId || cityIds.length === 0) {
    return res.status(403).json({ error: "Administrador sem cidade autorizada" });
  }

  const universities = await prisma.university.findMany({
    where: { cityId: { in: cityIds } },
    include: { city: true },
    orderBy: [{ name: "asc" }, { cityId: "asc" }],
  });

  return res.json(universities);
}

export async function createUniversity(req, res) {
  const cityIds = allowedCityIds(req);
  const name = cleanName(req.body?.name);
  const requestedCityId = req.body?.cityId ? parseId(req.body.cityId) : req.user?.cityId;

  if (!name) {
    return res.status(400).json({ error: "Nome da universidade é obrigatório" });
  }

  if (!requestedCityId || !cityIds.includes(requestedCityId)) {
    return res.status(403).json({ error: "Cidade não permitida" });
  }

  const city = await prisma.city.findUnique({ where: { id: requestedCityId } });
  if (!city) {
    return res.status(404).json({ error: "Cidade não encontrada" });
  }

  const duplicate = await prisma.university.findFirst({
    where: {
      cityId: requestedCityId,
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (duplicate) {
    return res.status(409).json({ error: "Universidade já cadastrada nesta cidade" });
  }

  const university = await prisma.university.create({
    data: {
      name,
      cityId: requestedCityId,
      cityName: cleanName(req.body?.cityName) || city.name,
    },
    include: { city: true },
  });

  await createAuditLog({
    userId: req.user.id,
    cityId: req.user.cityId,
    action: "create",
    entity: "University",
    entityId: university.id,
    description: "Universidade cadastrada",
    metadata: { targetCityId: requestedCityId },
    ...getRequestAuditData(req, res),
  });

  return res.status(201).json(university);
}

export async function updateUniversity(req, res) {
  const cityIds = allowedCityIds(req);
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const current = await prisma.university.findUnique({ where: { id } });
  if (!current || !current.cityId || !cityIds.includes(current.cityId)) {
    return res.status(404).json({ error: "Universidade não encontrada para suas cidades autorizadas" });
  }

  const nextName = req.body?.name === undefined ? current.name : cleanName(req.body.name);
  const nextCityId = req.body?.cityId === undefined ? current.cityId : parseId(req.body.cityId);

  if (!nextName) {
    return res.status(400).json({ error: "Nome da universidade é obrigatório" });
  }

  if (!nextCityId || !cityIds.includes(nextCityId)) {
    return res.status(403).json({ error: "Cidade não permitida" });
  }

  const city = await prisma.city.findUnique({ where: { id: nextCityId } });
  if (!city) {
    return res.status(404).json({ error: "Cidade não encontrada" });
  }

  const duplicate = await prisma.university.findFirst({
    where: {
      id: { not: id },
      cityId: nextCityId,
      name: { equals: nextName, mode: "insensitive" },
    },
  });

  if (duplicate) {
    return res.status(409).json({ error: "Universidade já cadastrada nesta cidade" });
  }

  const updated = await prisma.university.update({
    where: { id },
    data: {
      name: nextName,
      cityId: nextCityId,
      cityName: req.body?.cityName === undefined ? current.cityName : cleanName(req.body.cityName) || city.name,
    },
    include: { city: true },
  });

  await createAuditLog({
    userId: req.user.id,
    cityId: req.user.cityId,
    action: "update",
    entity: "University",
    entityId: id,
    description: "Universidade atualizada",
    metadata: { targetCityId: nextCityId },
    ...getRequestAuditData(req, res),
  });

  return res.json(updated);
}

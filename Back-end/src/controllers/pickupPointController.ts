import { prisma } from "../lib/prisma";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

function allowedCityIds(req): number[] {
  return req.allowedCities ?? (req.user?.cityId ? [req.user.cityId] : []);
}

function parseId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseCoordinate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

async function validateUniversity(universityId: number | null, cityId: number, type: "ida" | "volta") {
  if (type === "ida") return null;
  if (!universityId) throw new Error("Universidade é obrigatória para pontos de volta");

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university || university.cityId !== cityId) {
    throw new Error("Universidade deve pertencer à mesma cidade do ponto de volta");
  }
  return university;
}

export async function listPickupPoints(req, res) {
  const cityIds = allowedCityIds(req);
  if (!cityIds.length) return res.status(403).json({ error: "Administrador sem cidade autorizada" });

  const type = req.query?.type === "ida" || req.query?.type === "volta" ? req.query.type : undefined;
  const active = req.query?.active === undefined ? undefined : String(req.query.active) === "true";

  const points = await prisma.pickupPoint.findMany({
    where: {
      cityId: { in: cityIds },
      type,
      active,
    },
    include: { city: true, university: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return res.json(points);
}

export async function createPickupPoint(req, res) {
  const cityIds = allowedCityIds(req);
  const cityId = parseId(req.body?.cityId) ?? req.user?.cityId;
  const type: "ida" | "volta" = req.body?.type === "volta" ? "volta" : "ida";
  const universityId = parseId(req.body?.universityId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const latitude = parseCoordinate(req.body?.latitude);
  const longitude = parseCoordinate(req.body?.longitude);

  if (!cityId || !cityIds.includes(cityId)) return res.status(403).json({ error: "Cidade não permitida" });
  if (!name) return res.status(400).json({ error: "Nome do ponto é obrigatório" });
  if (latitude === null || longitude === null) return res.status(400).json({ error: "Latitude ou longitude inválida" });

  try {
    await validateUniversity(universityId, cityId, type);

    const duplicate = await prisma.pickupPoint.findFirst({
      where: { cityId, type, name: { equals: name, mode: "insensitive" } },
    });
    if (duplicate) return res.status(409).json({ error: "Já existe um ponto com este nome e tipo na cidade" });

    const point = await prisma.pickupPoint.create({
      data: {
        name,
        address: req.body?.address ? String(req.body.address).trim() : undefined,
        latitude,
        longitude,
        type,
        universityId: type === "volta" ? universityId : null,
        active: req.body?.active !== false,
        cityId,
      },
      include: { city: true, university: true },
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "create",
      entity: "PickupPoint",
      entityId: point.id,
      description: `Ponto de ${type} cadastrado`,
      metadata: { pointCityId: cityId, universityId: point.universityId },
      ...getRequestAuditData(req, res),
    });

    return res.status(201).json(point);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível criar o ponto" });
  }
}

export async function updatePickupPoint(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const cityIds = allowedCityIds(req);
  const current = await prisma.pickupPoint.findUnique({ where: { id } });
  if (!current || !cityIds.includes(current.cityId)) {
    return res.status(404).json({ error: "Ponto de embarque não encontrado" });
  }

  const cityId = req.body?.cityId === undefined ? current.cityId : parseId(req.body.cityId);
  const type: "ida" | "volta" = req.body?.type === undefined ? current.type : req.body.type === "volta" ? "volta" : "ida";
  const universityId = req.body?.universityId === undefined ? current.universityId : parseId(req.body.universityId);
  const name = req.body?.name === undefined ? current.name : String(req.body.name).trim();
  const latitude = parseCoordinate(req.body?.latitude);
  const longitude = parseCoordinate(req.body?.longitude);

  if (!cityId || !cityIds.includes(cityId)) return res.status(403).json({ error: "Cidade não permitida" });
  if (!name) return res.status(400).json({ error: "Nome do ponto é obrigatório" });
  if (latitude === null || longitude === null) return res.status(400).json({ error: "Latitude ou longitude inválida" });

  try {
    await validateUniversity(universityId, cityId, type);

    const duplicate = await prisma.pickupPoint.findFirst({
      where: {
        id: { not: id },
        cityId,
        type,
        name: { equals: name, mode: "insensitive" },
      },
    });
    if (duplicate) return res.status(409).json({ error: "Já existe um ponto com este nome e tipo na cidade" });

    const updated = await prisma.pickupPoint.update({
      where: { id },
      data: {
        name,
        address: req.body?.address === undefined ? undefined : String(req.body.address ?? "").trim() || null,
        latitude,
        longitude,
        type,
        universityId: type === "volta" ? universityId : null,
        active: req.body?.active,
        cityId,
      },
      include: { city: true, university: true },
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "update",
      entity: "PickupPoint",
      entityId: id,
      description: "Ponto atualizado",
      metadata: { pointCityId: cityId, universityId: updated.universityId },
      ...getRequestAuditData(req, res),
    });

    return res.json(updated);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o ponto" });
  }
}

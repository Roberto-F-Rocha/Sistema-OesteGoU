import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createNotification } from "../services/notificationService";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

async function notifyCityAdmins(cityId: number, title: string, message: string, metadata: Record<string, unknown> = {}) {
  const admins = await prisma.user.findMany({
    where: { cityId, role: "admin", status: "active" },
    select: { id: true },
  });

  await Promise.all(admins.map((admin) => createNotification({
    userId: admin.id,
    title,
    message,
    type: NotificationType.info,
    link: "/admin/parcerias",
    metadata,
  })));

  return admins.length;
}

function parseOptionalDate(value: unknown) {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listCityAgreements(req, res) {
  const cityId = req.user?.cityId;
  if (!cityId) return res.status(403).json({ error: "Usuário sem cidade definida" });

  const agreements = await prisma.cityAgreement.findMany({
    where: { OR: [{ requesterCityId: cityId }, { partnerCityId: cityId }] },
    include: {
      requesterCity: true,
      partnerCity: true,
      requestedBy: { select: { id: true, nome: true, email: true } },
      approvedBy: { select: { id: true, nome: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return res.json(agreements);
}

export async function createCityAgreement(req, res) {
  const user = req.user;
  if (!user?.cityId) return res.status(403).json({ error: "Usuário sem cidade definida" });

  const requesterCityId = Number(user.cityId);
  const partnerCityId = Number(req.body?.partnerCityId);
  const title = String(req.body?.title ?? "Vínculo de transporte universitário").trim().slice(0, 160);
  const description = req.body?.description ? String(req.body.description).trim().slice(0, 1000) : undefined;
  const startsAt = parseOptionalDate(req.body?.startsAt);
  const endsAt = parseOptionalDate(req.body?.endsAt);

  if (!Number.isInteger(partnerCityId) || partnerCityId <= 0) {
    return res.status(400).json({ error: "Cidade parceira inválida" });
  }
  if (partnerCityId === requesterCityId) {
    return res.status(400).json({ error: "Não é possível vincular a cidade com ela mesma" });
  }
  if (startsAt === null || endsAt === null) {
    return res.status(400).json({ error: "Data de início ou término inválida" });
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return res.status(400).json({ error: "A data de término deve ser posterior à data de início" });
  }

  const [requesterCity, partnerCity] = await Promise.all([
    prisma.city.findUnique({ where: { id: requesterCityId } }),
    prisma.city.findUnique({ where: { id: partnerCityId } }),
  ]);
  if (!requesterCity) return res.status(404).json({ error: "Cidade solicitante não encontrada" });
  if (!partnerCity) return res.status(404).json({ error: "Cidade parceira não encontrada" });

  const existing = await prisma.cityAgreement.findFirst({
    where: {
      status: { in: ["pending", "active"] },
      OR: [
        { requesterCityId, partnerCityId },
        { requesterCityId: partnerCityId, partnerCityId: requesterCityId },
      ],
    },
  });

  if (existing) {
    return res.status(409).json({ error: existing.status === "active" ? "Já existe um vínculo ativo com essa cidade" : "Já existe uma solicitação pendente com essa cidade" });
  }

  const agreement = await prisma.cityAgreement.create({
    data: {
      requesterCityId,
      partnerCityId,
      status: "pending",
      title: title || "Vínculo de transporte universitário",
      description,
      startsAt: startsAt ?? undefined,
      endsAt: endsAt ?? undefined,
      requestedById: user.id,
    },
    include: {
      requesterCity: true,
      partnerCity: true,
      requestedBy: { select: { id: true, nome: true, email: true } },
      approvedBy: { select: { id: true, nome: true, email: true } },
    },
  });

  await notifyCityAdmins(partnerCityId, "Novo convite de parceria", `${requesterCity.name}/${requesterCity.state} enviou um convite para parceria de transporte universitário.`, {
    source: "city_agreement_invite",
    agreementId: agreement.id,
    requesterCityId,
    partnerCityId,
  });

  await createAuditLog({
    userId: user.id,
    cityId: requesterCityId,
    action: "create",
    entity: "CityAgreement",
    entityId: agreement.id,
    description: `Solicitou vínculo com ${partnerCity.name}/${partnerCity.state}`,
    metadata: { partnerCityId, agreementId: agreement.id },
    ...getRequestAuditData(req, res),
  });

  return res.status(201).json(agreement);
}

export async function updateCityAgreementStatus(req, res) {
  const user = req.user;
  const agreementId = Number(req.params.id);
  const status = String(req.body?.status ?? "");

  if (!user?.cityId) return res.status(403).json({ error: "Usuário sem cidade definida" });
  if (!Number.isInteger(agreementId) || agreementId <= 0) return res.status(400).json({ error: "ID inválido" });

  const agreement = await prisma.cityAgreement.findUnique({
    where: { id: agreementId },
    include: { requesterCity: true, partnerCity: true },
  });
  if (!agreement) return res.status(404).json({ error: "Vínculo não encontrado" });

  const userCityId = Number(user.cityId);
  const isRequester = agreement.requesterCityId === userCityId;
  const isPartner = agreement.partnerCityId === userCityId;
  if (!isRequester && !isPartner) return res.status(403).json({ error: "Você não tem permissão para alterar esse vínculo" });

  const transitionAllowed =
    (agreement.status === "pending" && isPartner && ["active", "rejected"].includes(status)) ||
    (agreement.status === "pending" && isRequester && status === "canceled") ||
    (agreement.status === "active" && (isRequester || isPartner) && status === "inactive");

  if (!transitionAllowed) {
    return res.status(400).json({
      error: agreement.status === "pending"
        ? "Convites pendentes só podem ser aceitos/rejeitados pela cidade convidada ou cancelados pela solicitante"
        : agreement.status === "active"
          ? "Parcerias ativas só podem ser inativadas"
          : "Este vínculo não possui mais transições disponíveis",
    });
  }

  const updated = await prisma.cityAgreement.update({
    where: { id: agreementId },
    data: {
      status: status as any,
      approvedById: status === "active" ? user.id : agreement.approvedById,
    },
    include: {
      requesterCity: true,
      partnerCity: true,
      requestedBy: { select: { id: true, nome: true, email: true } },
      approvedBy: { select: { id: true, nome: true, email: true } },
    },
  });

  if (status === "active" || status === "rejected") {
    await notifyCityAdmins(agreement.requesterCityId, status === "active" ? "Parceria aceita" : "Parceria rejeitada", `${agreement.partnerCity.name}/${agreement.partnerCity.state} ${status === "active" ? "aceitou" : "rejeitou"} seu convite de parceria.`, {
      source: status === "active" ? "city_agreement_accepted" : "city_agreement_rejected",
      agreementId,
    });
  } else if (status === "inactive") {
    const otherCityId = isRequester ? agreement.partnerCityId : agreement.requesterCityId;
    await notifyCityAdmins(otherCityId, "Parceria inativada", `O vínculo entre ${agreement.requesterCity.name}/${agreement.requesterCity.state} e ${agreement.partnerCity.name}/${agreement.partnerCity.state} foi inativado.`, {
      source: "city_agreement_inactivated",
      agreementId,
    });
  }

  await createAuditLog({
    userId: user.id,
    cityId: userCityId,
    action: status === "active" ? "approve" : status === "rejected" ? "reject" : status === "canceled" ? "cancel" : "update",
    entity: "CityAgreement",
    entityId: updated.id,
    description: `Alterou vínculo entre cidades para ${status}`,
    metadata: { status, agreementId: updated.id, requesterCityId: updated.requesterCityId, partnerCityId: updated.partnerCityId },
    ...getRequestAuditData(req, res),
  });

  return res.json(updated);
}

export async function listCities(req, res) {
  const cityId = req.user?.cityId;
  if (!cityId) return res.status(403).json({ error: "Usuário sem cidade definida" });

  const cities = await prisma.city.findMany({
    where: { id: { not: Number(cityId) } },
    orderBy: [{ state: "asc" }, { name: "asc" }],
  });

  return res.json(cities);
}

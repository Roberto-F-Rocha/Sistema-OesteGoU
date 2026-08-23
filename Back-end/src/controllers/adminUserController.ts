import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createNotification } from "../services/notificationService";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

const VALID_STATUSES = ["active", "pending", "inactive", "blocked"] as const;
type UserStatusValue = (typeof VALID_STATUSES)[number];

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function updateUserStatus(req, res) {
  const id = parseId(req.params.id);
  const status = req.body?.status as UserStatusValue;
  const allowedCities: number[] = req.allowedCities ?? (req.user?.cityId ? [req.user.cityId] : []);

  if (!id) return res.status(400).json({ error: "ID inválido" });
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Status inválido" });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      documents: {
        where: { type: "enrollment_proof" },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, moderationStatus: true, createdAt: true },
      },
    },
  });

  if (!user || !user.cityId || !allowedCities.includes(user.cityId)) {
    return res.status(404).json({ error: "Usuário não encontrado para suas cidades autorizadas" });
  }

  if (user.role === "admin" && user.id === req.user.id && status !== "active") {
    return res.status(400).json({ error: "Você não pode desativar ou bloquear a própria conta administrativa" });
  }

  if (user.role === "student" && user.status === "pending" && status === "active") {
    const approvedProof = user.documents.find((document) => document.status === "approved");
    if (!approvedProof) {
      return res.status(409).json({
        error: "Aprove o comprovante de matrícula antes de ativar o aluno",
        code: "ENROLLMENT_PROOF_REQUIRED",
      });
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      status: true,
      city: true,
    },
  });

  const notificationByStatus: Partial<Record<UserStatusValue, { title: string; message: string; type: NotificationType }>> = {
    active: {
      title: "Cadastro liberado",
      message: "Seu acesso ao OesteGoU foi liberado pela administração.",
      type: NotificationType.success,
    },
    inactive: {
      title: "Cadastro desativado",
      message: "Seu acesso ao OesteGoU foi desativado pela administração.",
      type: NotificationType.warning,
    },
    blocked: {
      title: "Cadastro bloqueado",
      message: "Seu acesso ao OesteGoU foi bloqueado pela administração.",
      type: NotificationType.warning,
    },
  };

  const notification = notificationByStatus[status];
  if (notification && user.id !== req.user.id) {
    await createNotification({
      userId: user.id,
      ...notification,
      metadata: { source: "admin_user_status", status },
    });
  }

  await createAuditLog({
    userId: req.user.id,
    cityId: req.user.cityId,
    action: "update",
    entity: "User",
    entityId: id,
    description: `Status do usuário alterado para ${status}`,
    metadata: { previousStatus: user.status, status, targetRole: user.role },
    ...getRequestAuditData(req, res),
  });

  return res.json(updated);
}

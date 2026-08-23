import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { notifyUsers } from "../services/notificationService";

function getHour(time) {
  const hour = Number(String(time ?? "").split(":")[0]);
  return Number.isFinite(hour) ? hour : -1;
}

function shiftFromTime(time) {
  const hour = getHour(time);
  if (hour >= 18) return "noite";
  if (hour >= 12) return "tarde";
  return "manha";
}

async function createNotifications(
  userIds: Array<number | null | undefined>,
  title: string,
  message: string,
  type: NotificationType = NotificationType.info,
  metadata: Record<string, unknown> = {},
) {
  const uniqueIds = Array.from(
    new Set(userIds.filter((userId): userId is number => typeof userId === "number")),
  );

  if (uniqueIds.length === 0) return 0;
  await notifyUsers(uniqueIds, { title, message, type, metadata });
  return uniqueIds.length;
}

export async function getDriverRoutes(req, res) {
  const user = req.user;

  if (user?.role !== "driver") {
    return res.status(403).json({ error: "Acesso permitido apenas para motoristas" });
  }

  if (!user.cityId) {
    return res.status(403).json({ error: "Usuário sem cidade definida" });
  }

  const routes = await prisma.transportRoute.findMany({
    where: {
      cityId: user.cityId,
      driverId: user.id,
    },
    include: {
      city: true,
      schedule: { include: { university: true } },
      vehicle: true,
      driver: {
        select: {
          id: true,
          nome: true,
          email: true,
          phone: true,
        },
      },
      points: {
        include: { pickupPoint: true },
        orderBy: { order: "asc" },
      },
      reservations: {
        include: {
          user: {
            select: {
              id: true,
              nome: true,
              email: true,
              phone: true,
              institution: true,
              city: true,
            },
          },
          pickupPoint: true,
        },
        orderBy: [{ dayOfWeek: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return res.json(routes);
}

export async function notifyDriverPendingStudents(req, res) {
  const user = req.user;

  if (user?.role !== "driver") {
    return res.status(403).json({ error: "Acesso permitido apenas para motoristas" });
  }

  if (!user.cityId) {
    return res.status(403).json({ error: "Usuário sem cidade definida" });
  }

  const { userIds, message, trip, targetMode, routeId, dayOfWeek, shift } = req.body ?? {};
  const cleanMessage = String(message ?? "").trim() ||
    "Olá! Sua confirmação de presença ainda está pendente. Pode confirmar sua viagem?";

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: "Nenhum aluno selecionado" });
  }

  if (cleanMessage.length > 500) {
    return res.status(400).json({ error: "Mensagem deve ter no máximo 500 caracteres" });
  }

  const numericUserIds = Array.from(
    new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))),
  );

  if (numericUserIds.length === 0) {
    return res.status(400).json({ error: "Alunos inválidos" });
  }

  const routeIdNumber = routeId !== undefined && routeId !== null && routeId !== ""
    ? Number(routeId)
    : undefined;

  if (routeIdNumber !== undefined && !Number.isFinite(routeIdNumber)) {
    return res.status(400).json({ error: "Rota inválida" });
  }

  const candidateReservations = await prisma.reservation.findMany({
    where: {
      userId: { in: numericUserIds },
      status: "pending",
      route: {
        cityId: user.cityId,
        driverId: user.id,
        ...(routeIdNumber ? { id: routeIdNumber } : {}),
        ...(trip === "ida" || trip === "volta" ? { schedule: { type: trip } } : {}),
      },
      ...(dayOfWeek ? { dayOfWeek: String(dayOfWeek) } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          nome: true,
          email: true,
          city: true,
          institution: true,
        },
      },
      route: {
        include: {
          schedule: { include: { university: true } },
          vehicle: true,
          city: true,
        },
      },
      pickupPoint: true,
    },
  });

  const reservations = candidateReservations.filter((reservation) =>
    !shift || shiftFromTime(reservation.route?.schedule?.time) === shift,
  );

  const allowedStudentIds = Array.from(
    new Set(reservations.map((reservation) => reservation.userId)),
  );

  if (allowedStudentIds.length === 0) {
    return res.status(404).json({
      error: "Nenhum aluno pendente encontrado para essa rota, dia e turno",
    });
  }

  const first = reservations[0];
  const scheduleTime = first?.route?.schedule?.time ?? "horário não informado";
  const universityName = first?.route?.schedule?.university?.name ?? "universidade não informada";
  const vehicleName = first?.route?.vehicle?.name || first?.route?.vehicle?.plate || "veículo não informado";
  const sentAt = new Date();

  const sent = await createNotifications(
    allowedStudentIds,
    "Confirmação de viagem",
    cleanMessage,
    NotificationType.warning,
    {
      senderId: user.id,
      senderRole: user.role,
      senderName: user.nome,
      trip: trip === "volta" ? "volta" : "ida",
      routeId: first?.routeId,
      dayOfWeek: first?.dayOfWeek,
      shift: shift ?? shiftFromTime(first?.route?.schedule?.time),
      source: "driver_pending_students",
      targetMode: targetMode === "single" ? "single" : "all",
      scheduleTime,
      universityName,
      sentAt: sentAt.toISOString(),
    },
  );

  const admins = await prisma.user.findMany({
    where: {
      role: "admin",
      cityId: user.cityId,
      status: "active",
    },
    select: { id: true },
  });

  const studentNames = Array.from(new Set(reservations.map((reservation) => {
    const cityName = reservation.user.city?.name;
    return `${reservation.user.nome}${cityName ? ` (${cityName})` : ""}`;
  })));

  const adminMessage = `${user.nome} sinalizou ${sent} aluno(s) da ${
    trip === "volta" ? "volta" : "ida"
  } às ${scheduleTime} (${universityName})${dayOfWeek ? ` no dia ${dayOfWeek}` : ""}. Mensagem enviada: "${cleanMessage}"`;

  const adminsNotified = await createNotifications(
    admins.map((admin) => admin.id),
    "Motorista sinalizou alunos",
    adminMessage,
    NotificationType.info,
    {
      senderId: user.id,
      senderName: user.nome,
      trip: trip === "volta" ? "volta" : "ida",
      routeId: first?.routeId,
      dayOfWeek: first?.dayOfWeek,
      shift: shift ?? shiftFromTime(first?.route?.schedule?.time),
      scheduleTime,
      universityName,
      vehicleName,
      sentAt: sentAt.toISOString(),
      studentsCount: sent,
      studentNames,
      source: "driver_pending_students_admin_copy",
    },
  );

  return res.json({
    sent,
    adminsNotified,
    sentAt,
    students: allowedStudentIds.length,
  });
}

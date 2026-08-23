import cron from "node-cron";
import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sendPushToUser } from "../services/pushService";
import { createNotification } from "../services/notificationService";

const TIME_ZONE = "America/Fortaleza";
const DAY_NAMES: Record<string, string> = {
  Monday: "Segunda",
  Tuesday: "Terça",
  Wednesday: "Quarta",
  Thursday: "Quinta",
  Friday: "Sexta",
  Saturday: "Sábado",
  Sunday: "Domingo",
};

function getLocalClock(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    dayOfWeek: DAY_NAMES[parts.weekday] ?? parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function scheduleMinutes(time?: string | null) {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

async function reminderAlreadySent(userId: number, reservationId: number) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.notification.findMany({
    where: {
      userId,
      createdAt: { gte: since },
      title: "Sua viagem está próxima",
    },
    select: { metadata: true },
  });

  return recent.some((notification) => {
    const metadata = notification.metadata;
    return Boolean(
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      Number((metadata as Record<string, unknown>).reservationId) === reservationId,
    );
  });
}

export function startPushJobs() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();
      const local = getLocalClock(now);

      const reservations = await prisma.reservation.findMany({
        where: {
          status: "confirmed",
          dayOfWeek: local.dayOfWeek,
          route: { active: true, schedule: { active: true } },
        },
        include: {
          schedule: true,
          route: { include: { schedule: true } },
        },
      });

      for (const reservation of reservations) {
        const schedule = reservation.route?.schedule ?? reservation.schedule;
        const departure = scheduleMinutes(schedule?.time);
        if (departure === null) continue;

        const diffMinutes = departure - local.minutes;
        if (diffMinutes <= 0 || diffMinutes > 60) continue;
        if (await reminderAlreadySent(reservation.userId, reservation.id)) continue;

        const link = "/aluno";
        const message = `Seu ônibus sai às ${schedule?.time}. Falta menos de uma hora.`;

        await createNotification({
          userId: reservation.userId,
          title: "Sua viagem está próxima",
          message,
          type: NotificationType.warning,
          link,
          metadata: {
            source: "trip_reminder",
            reservationId: reservation.id,
            routeId: reservation.routeId,
            scheduleId: reservation.scheduleId,
            dayOfWeek: reservation.dayOfWeek,
            departureTime: schedule?.time,
          },
        });

        try {
          await sendPushToUser(reservation.userId, {
            title: "Sua viagem está próxima",
            body: message,
            url: link,
          });
        } catch (pushError) {
          console.error("Falha no push web do lembrete; notificação interna foi mantida", pushError);
        }

        await prisma.analyticsEvent.create({
          data: {
            userId: reservation.userId,
            event: "push.trip_reminder",
            metadata: {
              reservationId: reservation.id,
              routeId: reservation.routeId,
              dayOfWeek: reservation.dayOfWeek,
            },
          },
        }).catch(() => undefined);
      }
    } catch (error) {
      console.error("Erro no cron de lembrete de viagem", error);
    }
  });
}

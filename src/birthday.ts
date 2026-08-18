import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Lunar, Solar } from "lunar-typescript";
import { getGreeting } from "./greetings";
import type { FamilyMember } from "./types";

const APP_TIMEZONE = "Asia/Shanghai";

dayjs.extend(utc);
dayjs.extend(timezone);

function nowInAppTimezone() {
  // 所有日期判断统一按东八区，避免 CI 环境默认 UTC 导致日期偏移。
  return dayjs().tz(APP_TIMEZONE);
}

export function getTodayBirthdayPeople(list: FamilyMember[]) {
  // 统一按东八区计算“今天”，避免运行环境时区差异造成日期偏差。
  const today = nowInAppTimezone();

  const solarMonth = today.month() + 1;
  const solarDay = today.date();

  const lunar = Solar.fromYmd(today.year(), solarMonth, solarDay).getLunar();
  const lunarMonth = lunar.getMonth();
  const lunarDay = lunar.getDay();

  return list.filter((person) => {
    if (person.birthdayType === "solar") {
      return person.birthMonth === solarMonth && person.birthDay === solarDay;
    }

    return person.birthMonth === lunarMonth && person.birthDay === lunarDay;
  });
}

export function buildBirthdayGreetingMessage(todayPeople: FamilyMember[]) {
  // 使用队长提供的固定祝福文案；多人同一天生日时分别标注姓名。
  const names = todayPeople.map((p) => p.name).join("、");
  const blocks = todayPeople.map((person) => {
    const greeting = getGreeting(person.name);
    return todayPeople.length > 1 ? `【${person.name}】\n${greeting}` : greeting;
  });

  return ["🎂 今天生日：" + names, "", blocks.join("\n\n")].join("\n");
}

/**
 * 读取生日名单：优先环境变量 BIRTHDAYS_JSON，否则读根目录 birthdays.json。
 * 从 index.ts 移到这里，供「每日推送」与「指令回复」两个入口复用。
 */
export async function loadBirthdays(): Promise<FamilyMember[]> {
  const fromEnv = process.env.BIRTHDAYS_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("BIRTHDAYS_JSON 必须是数组");
      }
      return parsed as FamilyMember[];
    } catch (error) {
      throw new Error(
        `BIRTHDAYS_JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const file = Bun.file("birthdays.json");
  if (await file.exists()) {
    const parsed = (await file.json()) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("birthdays.json 必须是数组");
    }
    return parsed as FamilyMember[];
  }

  throw new Error(
    "缺少生日数据：请提供 BIRTHDAYS_JSON，或在项目根目录创建 birthdays.json",
  );
}

export interface UpcomingBirthday {
  member: FamilyMember;
  days: number;
}

function toDateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function compareSolar(a: Solar, b: Solar): number {
  if (a.getYear() !== b.getYear()) return a.getYear() - b.getYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() - b.getMonth();
  return a.getDay() - b.getDay();
}

/**
 * 计算每个成员下一个生日的公历日期，按「还有几天」升序返回前 N 个。
 * 农历生日会换算成对应年份的公历日期；某年无该农历日期（如三十）时跳过换下一年。
 */
export function getUpcomingBirthdays(
  list: FamilyMember[],
  limit = 3,
): UpcomingBirthday[] {
  const today = nowInAppTimezone();
  const todaySolar = Solar.fromYmd(today.year(), today.month() + 1, today.date());

  const results: UpcomingBirthday[] = [];

  for (const member of list) {
    let next: Solar | null = null;

    if (member.birthdayType === "solar") {
      let candidate = Solar.fromYmd(today.year(), member.birthMonth, member.birthDay);
      if (compareSolar(candidate, todaySolar) < 0) {
        candidate = Solar.fromYmd(today.year() + 1, member.birthMonth, member.birthDay);
      }
      next = candidate;
    } else {
      for (let year = today.year(); year <= today.year() + 1; year++) {
        try {
          const candidate = Lunar.fromYmd(
            year,
            member.birthMonth,
            member.birthDay,
          ).getSolar();
          if (compareSolar(candidate, todaySolar) >= 0) {
            next = candidate;
            break;
          }
        } catch {
          // 该年无此农历日期，跳到下一年
        }
      }
    }

    if (!next) continue;

    const candidateStr = toDateString(next.getYear(), next.getMonth(), next.getDay());
    const days = dayjs
      .tz(candidateStr, APP_TIMEZONE)
      .diff(today.startOf("day"), "day");

    results.push({ member, days });
  }

  results.sort((a, b) => a.days - b.days);
  return results.slice(0, limit);
}

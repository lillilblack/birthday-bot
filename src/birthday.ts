import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Lunar, Solar } from "lunar-typescript";
import { loadOverlay } from "./store";
import type { FamilyMember } from "./types";

const APP_TIMEZONE = "Asia/Shanghai";

dayjs.extend(utc);
dayjs.extend(timezone);

function nowInAppTimezone() {
  // 所有日期判断统一按东八区，避免 CI 环境默认 UTC 导致日期偏移。
  return dayjs().tz(APP_TIMEZONE);
}

// 判断某个成员在指定「东八区日期」是否生日：
// 阳历直接比月日；农历先把当天公历换算成农历，再比月日。
function isBirthdayOn(person: FamilyMember, date: dayjs.Dayjs): boolean {
  const solar = Solar.fromYmd(date.year(), date.month() + 1, date.date());
  if (person.birthdayType === "solar") {
    return (
      person.birthMonth === solar.getMonth() && person.birthDay === solar.getDay()
    );
  }
  const lunar = solar.getLunar();
  return (
    person.birthMonth === lunar.getMonth() && person.birthDay === lunar.getDay()
  );
}

export function getTodayBirthdayPeople(list: FamilyMember[]) {
  return list.filter((p) => isBirthdayOn(p, nowInAppTimezone()));
}

export function getTomorrowBirthdayPeople(list: FamilyMember[]) {
  return list.filter((p) => isBirthdayOn(p, nowInAppTimezone().add(1, "day")));
}

// 主名单：优先 BIRTHDAYS_JSON（云端 Secret），否则读 birthdays.json（本地）。
async function loadBase(): Promise<FamilyMember[]> {
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

/**
 * 读取有效生日名单：主名单 + 微信自助新增/修改的 overlay 合并。
 * overlay 里同 id 的成员覆盖主名单，overlay 独有的追加在末尾。
 */
export async function loadBirthdays(): Promise<FamilyMember[]> {
  const base = await loadBase();
  const overlay = await loadOverlay();
  if (overlay.length === 0) return base;

  const overlayById = new Map(overlay.map((m) => [m.id, m]));
  const merged = base.map((m) => overlayById.get(m.id) ?? m);
  const baseIds = new Set(base.map((m) => m.id));
  for (const m of overlay) {
    if (!baseIds.has(m.id)) merged.push(m);
  }
  return merged;
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

// 计算某个成员下一个生日对应的公历日期（今天已过则顺延到下一年）。
// 农历生日会换算成对应年份的公历日期；某年无该农历日期（如三十）时换下一年。
function nextBirthdaySolar(member: FamilyMember, todaySolar: Solar): Solar | null {
  if (member.birthdayType === "solar") {
    let candidate = Solar.fromYmd(
      todaySolar.getYear(),
      member.birthMonth,
      member.birthDay,
    );
    if (compareSolar(candidate, todaySolar) < 0) {
      candidate = Solar.fromYmd(
        todaySolar.getYear() + 1,
        member.birthMonth,
        member.birthDay,
      );
    }
    return candidate;
  }

  for (let year = todaySolar.getYear(); year <= todaySolar.getYear() + 1; year++) {
    try {
      const candidate = Lunar.fromYmd(
        year,
        member.birthMonth,
        member.birthDay,
      ).getSolar();
      if (compareSolar(candidate, todaySolar) >= 0) {
        return candidate;
      }
    } catch {
      // 该年无此农历日期，跳到下一年
    }
  }
  return null;
}

// 返回某个成员距离下一个生日还有几天（0 表示今天）；无法计算时为 null。
export function getDaysUntilBirthday(member: FamilyMember): number | null {
  const today = nowInAppTimezone();
  const todaySolar = Solar.fromYmd(today.year(), today.month() + 1, today.date());
  const next = nextBirthdaySolar(member, todaySolar);
  if (!next) return null;

  const candidateStr = toDateString(next.getYear(), next.getMonth(), next.getDay());
  return dayjs
    .tz(candidateStr, APP_TIMEZONE)
    .diff(today.startOf("day"), "day");
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
    const next = nextBirthdaySolar(member, todaySolar);
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

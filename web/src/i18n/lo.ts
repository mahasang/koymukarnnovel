import type { Messages } from "./messages"

/** ข้อความลาว (ร่างโดย Claude — เจ้าของตรวจแก้ได้ในไฟล์นี้ไฟล์เดียว) */
export const lo: Messages = {
  locale: "lo",
  lang: { menuLabel: "ພາສາ" },
  time: {
    justNow: "ຫາກໍ່ນີ້",
    minutesAgo: (n) => `${n} ນາທີກ່ອນ`,
    hoursAgo: (n) => `${n} ຊົ່ວໂມງກ່ອນ`,
    yesterday: "ມື້ວານນີ້",
    daysAgo: (n) => `${n} ມື້ກ່ອນ`,
    weeksAgo: (n) => `${n} ອາທິດກ່ອນ`,
  },
}

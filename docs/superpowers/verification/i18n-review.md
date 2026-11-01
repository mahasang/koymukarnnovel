# ตารางตรวจคำแปล UI หน้าบ้าน (ไทย / English / ລາວ)

สร้างจาก `web/src/i18n/{th,en,lo}.ts` — แก้คำแปลที่ไฟล์เหล่านั้นแล้วสร้างตารางใหม่ (ข้อความแบบฟังก์ชันแสดงผลเมื่อใส่เลข 7 ในทุกช่อง)

| คีย์ | ไทย | English | ລາວ |
| --- | --- | --- | --- |
| `locale` | th | en | lo |
| `lang.menuLabel` | ภาษา | Language | ພາສາ |
| `time.justNow` | เมื่อสักครู่ | just now | ຫາກໍ່ນີ້ |
| `time.minutesAgo` | 7 นาทีที่แล้ว | 7 minutes ago | 7 ນາທີກ່ອນ |
| `time.hoursAgo` | 7 ชั่วโมงที่แล้ว | 7 hours ago | 7 ຊົ່ວໂມງກ່ອນ |
| `time.yesterday` | เมื่อวาน | yesterday | ມື້ວານນີ້ |
| `time.daysAgo` | 7 วันที่แล้ว | 7 days ago | 7 ມື້ກ່ອນ |
| `time.weeksAgo` | 7 สัปดาห์ที่แล้ว | 7 weeks ago | 7 ອາທິດກ່ອນ |
| `errors.title` | โหลดข้อมูลไม่สำเร็จ | Couldn't load this | ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ |
| `errors.retry` | ลองใหม่ | Try again | ລອງໃໝ່ |
| `errors.networkHint` | ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง | Check your internet connection and try again. | ກວດສອບອິນເຕີເນັດ ແລ້ວລອງອີກຄັ້ງ |
| `errors.serverHint` | เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่ | The server is having a temporary problem. Please try again in a moment. | ເຊີບເວີຂັດຂ້ອງຊົ່ວຄາວ ລອງໃໝ່ໃນອີກຈັກໜ້ອຍ |
| `errors.byCode.not_found` | ไม่พบข้อมูลที่ต้องการ | We couldn't find what you were looking for. | ບໍ່ພົບຂໍ້ມູນທີ່ຕ້ອງການ |
| `errors.byCode.rate_limited` | มีคำขอเข้ามาถี่เกินไป รอสักครู่แล้วลองใหม่ | Too many requests. Please wait a moment and try again. | ມີຄຳຂໍເຂົ້າມາຖີ່ເກີນໄປ ກະລຸນາລໍຖ້າຈັກໜ້ອຍ ແລ້ວລອງໃໝ່ |
| `errors.byCode.internal_error` | เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้งภายหลัง | Something went wrong on our side. Please try again later. | ເກີດຂໍ້ຜິດພາດໃນລະບົບ ກະລຸນາລອງໃໝ່ພາຍຫຼັງ |
| `errors.byCode.bad_request` | คำขอไม่ถูกต้อง | That request wasn't valid. | ຄຳຂໍບໍ່ຖືກຕ້ອງ |
| `errors.byCode.bad_json` | ข้อมูลที่ส่งมาไม่ถูกต้อง | The data sent was invalid. | ຂໍ້ມູນທີ່ສົ່ງມາບໍ່ຖືກຕ້ອງ |
| `errors.byCode.too_large` | ข้อมูลที่ส่งมาใหญ่เกินกำหนด | The data sent was too large. | ຂໍ້ມູນທີ່ສົ່ງມາໃຫຍ່ເກີນກຳນົດ |
| `errors.byCode.unsupported_media_type` | ไม่รองรับชนิดของข้อมูลที่ส่งมา | That data type isn't supported. | ບໍ່ຮອງຮັບຊະນິດຂອງຂໍ້ມູນທີ່ສົ່ງມາ |
| `errors.byCode.forbidden_origin` | คำขอนี้ไม่ได้รับอนุญาต | This request isn't allowed. | ຄຳຂໍນີ້ບໍ່ໄດ້ຮັບອະນຸຍາດ |
| `errors.byCode.forbidden_host` | คำขอนี้ไม่ได้รับอนุญาต | This request isn't allowed. | ຄຳຂໍນີ້ບໍ່ໄດ້ຮັບອະນຸຍາດ |
| `errors.byCode.method_not_allowed` | หน้าเว็บรับเฉพาะการอ่านข้อมูล | This page is read-only. | ໜ້າເວັບຮັບສະເພາະການອ່ານຂໍ້ມູນ |
| `errors.byCode.web_not_built` | เว็บยังไม่พร้อมใช้งาน | The site isn't ready yet. | ເວັບຍັງບໍ່ພ້ອມໃຊ້ງານ |
| `errors.byCode.network` | เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ | Couldn't connect to the server. | ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ |
| `errors.byCode.unknown_reply` | เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่รู้จัก | The server sent a reply we couldn't read. | ເຊີບເວີຕອບກັບໃນຮູບແບບທີ່ບໍ່ຮູ້ຈັກ |
| `errors.byCode.http_error` | เซิร์ฟเวอร์ตอบผิดพลาด | The server returned an error. | ເຊີບເວີຕອບຜິດພາດ |
| `errors.byCode.load_failed` | โหลดข้อมูลไม่สำเร็จ | Couldn't load the data. | ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ |
| `errors.crash.title` | หน้านี้แสดงผลไม่สำเร็จ | This page couldn't be displayed | ໜ້ານີ້ສະແດງຜົນບໍ່ສຳເລັດ |
| `errors.crash.message` | เกิดข้อผิดพลาดที่ไม่คาดคิด ลองโหลดหน้านี้ใหม่อีกครั้ง | An unexpected error occurred. Please reload this page. | ເກີດຂໍ້ຜິດພາດທີ່ບໍ່ຄາດຄິດ ລອງໂຫຼດໜ້ານີ້ໃໝ່ອີກຄັ້ງ |
| `errors.crash.reload` | โหลดหน้านี้ใหม่ | Reload this page | ໂຫຼດໜ້ານີ້ໃໝ່ |
| `states.loading` | กำลังโหลด… | Loading… | ກຳລັງໂຫຼດ… |
| `notFound.title` | ไม่พบหน้านี้ | Page not found | ບໍ່ພົບໜ້ານີ້ |
| `notFound.hint` | ลิงก์อาจเปลี่ยนไป หรือหน้านี้ยังไม่เปิดให้อ่าน | The link may have changed, or this page isn't open for reading yet. | ລິ້ງອາດປ່ຽນໄປ ຫຼື ໜ້ານີ້ຍັງບໍ່ເປີດໃຫ້ອ່ານ |
| `notFound.home` | กลับหน้าแรก | Back to home | ກັບໄປໜ້າຫຼັກ |
| `layout.skip` | ข้ามไปยังเนื้อหาหลัก | Skip to main content | ຂ້າມໄປຍັງເນື້ອຫາຫຼັກ |
| `header.menuLabel` | เมนูหลัก | Main menu | ເມນູຫຼັກ |
| `header.home` | หน้าแรก | Home | ໜ້າຫຼັກ |
| `header.about` | เกี่ยวกับ | About | ກ່ຽວກັບ |
| `header.contact` | ติดต่อ | Contact | ຕິດຕໍ່ |
| `header.admin` | หลังบ้าน | Admin | ຫຼັງບ້ານ |
| `footer.note` | นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม | Novels translated by AI. Rights to the content belong to the original authors. | ນິຍາຍແປໂດຍ AI ສິດໃນເນື້ອຫາເປັນຂອງເຈົ້າຂອງຜົນງານເດີມ |
| `footer.linksLabel` | ลิงก์ท้ายเว็บ | Footer links | ລິ້ງທ້າຍເວັບ |
| `footer.menu` | เมนู | Menu | ເມນູ |
| `footer.info` | ข้อมูล | Information | ຂໍ້ມູນ |
| `footer.home` | หน้าแรก | Home | ໜ້າຫຼັກ |
| `footer.about` | เกี่ยวกับเว็บไซต์ | About this site | ກ່ຽວກັບເວັບໄຊ |
| `footer.contact` | ติดต่อ / แจ้งลบเนื้อหา | Contact / report content for removal | ຕິດຕໍ່ / ແຈ້ງລຶບເນື້ອຫາ |
| `search.placeholder` | ค้นหาชื่อเรื่อง ผู้แต่ง หมวดหมู่… | Search title, author, category… | ຄົ້ນຫາຊື່ເລື່ອງ ຜູ້ແຕ່ງ ໝວດໝູ່… |
| `search.label` | ค้นหานิยาย | Search novels | ຄົ້ນຫານິຍາຍ |
| `theme.change` | เปลี่ยนธีม | Change theme | ປ່ຽນສີສັນ |
| `theme.menu` | ธีม | Theme | ສີສັນ |
| `theme.labels.midnight` | มืด | Midnight | ມືດ |
| `theme.labels.paper` | กระดาษ | Paper | ເຈ້ຍ |
| `theme.labels.sepia` | ซีเปีย | Sepia | ຊີເປຍ |
| `theme.labels.black` | ดำสนิท | Pitch black | ດຳສະນິດ |
| `home.emptyTitle` | ยังไม่มีนิยายให้อ่าน | No novels to read yet | ຍັງບໍ່ມີນິຍາຍໃຫ້ອ່ານ |
| `home.emptyHint` | กลับมาใหม่เร็วๆ นี้ | Check back soon. | ກັບມາໃໝ່ໃນໄວໆນີ້ |
| `home.goAdmin` | ไปหลังบ้านเพื่อเพิ่มนิยาย | Go to the admin area to add novels | ໄປຫຼັງບ້ານເພື່ອເພີ່ມນິຍາຍ |
| `home.latest` | อัปเดตล่าสุด | Latest updates | ອັບເດດຫຼ້າສຸດ |
| `home.searchTitle` | ค้นหา “7” | Search “7” | ຄົ້ນຫາ “7” |
| `library.statusAll` | ทั้งหมด | All | ທັງໝົດ |
| `library.statusOngoing` | กำลังอัปเดต | Ongoing | ກຳລັງອັບເດດ |
| `library.statusCompleted` | จบแล้ว | Completed | ຈົບແລ້ວ |
| `library.sortLatest` | อัปเดตล่าสุด | Latest update | ອັບເດດຫຼ້າສຸດ |
| `library.sortTitle` | ชื่อเรื่อง ก–ฮ | Title A–Z | ຊື່ເລື່ອງ ກ–ຮ |
| `library.resumeView` | ดูเรื่องนี้ | View this novel | ເບິ່ງເລື່ອງນີ້ |
| `library.resumeNew` | มีตอนใหม่ | New chapters | ມີຕອນໃໝ່ |
| `library.resumeCaughtUp` | อ่านทันตอนล่าสุดแล้ว | Caught up | ອ່ານທັນຕອນຫຼ້າສຸດແລ້ວ |
| `library.resumeContinue` | อ่านต่อ ตอนที่ 7 | Continue · Chapter 7 | ອ່ານຕໍ່ ຕອນທີ 7 |
| `library.headingAll` | นิยายทั้งหมด | All novels | ນິຍາຍທັງໝົດ |
| `library.headingSearch` | ผลการค้นหา “7” | Results for “7” | ຜົນການຄົ້ນຫາ “7” |
| `library.countNone` | ไม่พบเรื่อง | No novels found | ບໍ່ພົບເລື່ອງ |
| `library.countPartial` | แสดง 7 จาก 7 เรื่อง | Showing 7 of 7 novels | ສະແດງ 7 ຈາກ 7 ເລື່ອງ |
| `library.countAll` | 7 เรื่อง | 7 novels | 7 ເລື່ອງ |
| `library.statusGroup` | สถานะ | Status | ສະຖານະ |
| `library.sortBy` | เรียงตาม | Sort by | ຮຽງຕາມ |
| `library.tagGroup` | แท็ก | Tags | ແທັກ |
| `library.emptySearchTitle` | ไม่พบนิยายที่ตรงกับ “7” | No novels match “7” | ບໍ່ພົບນິຍາຍທີ່ກົງກັບ “7” |
| `library.emptyFilterTitle` | ไม่พบนิยายที่ตรงกับตัวกรอง | No novels match the filters | ບໍ່ພົບນິຍາຍທີ່ກົງກັບຕົວກອງ |
| `library.emptyHint` | ลองใช้คำอื่น หรือล้างตัวกรองเพื่อดูนิยายทั้งหมด | Try another word, or clear the filters to see all novels. | ລອງໃຊ້ຄຳອື່ນ ຫຼື ລ້າງຕົວກອງເພື່ອເບິ່ງນິຍາຍທັງໝົດ |
| `library.clearSearch` | ล้างการค้นหา | Clear search | ລ້າງການຄົ້ນຫາ |
| `library.clearFilters` | ล้างตัวกรอง | Clear filters | ລ້າງຕົວກອງ |
| `library.more` | แสดงเพิ่ม | Show more | ສະແດງເພີ່ມ |
| `library.moreLeft` | (อีก 7 เรื่อง) | (7 more) | (ອີກ 7 ເລື່ອງ) |
| `card.completed` | จบแล้ว | Completed | ຈົບແລ້ວ |
| `card.new` | ใหม่ | New | ໃໝ່ |
| `card.chapterChip` | ตอน 7 | Ch. 7 | ຕອນ 7 |
| `hero.featured` | เรื่องแนะนำ | Featured | ເລື່ອງແນະນຳ |
| `hero.latest` | อัปเดตล่าสุด | Latest update | ອັບເດດຫຼ້າສຸດ |
| `hero.by` | โดย 7 | by 7 | ໂດຍ 7 |
| `hero.ongoing` | ยังไม่จบ | Ongoing | ຍັງບໍ່ຈົບ |
| `hero.completed` | จบแล้ว | Completed | ຈົບແລ້ວ |
| `hero.chapters` | 7 ตอน | 7 chapters | 7 ຕອນ |
| `hero.start` | เริ่มอ่าน | Start reading | ເລີ່ມອ່ານ |
| `hero.details` | รายละเอียด | Details | ລາຍລະອຽດ |
| `continueRow.title` | อ่านต่อจากที่ค้างไว้ | Continue reading | ອ່ານຕໍ່ຈາກບ່ອນທີ່ຄ້າງໄວ້ |
| `continueRow.meta` | ตอนที่ 7 · อ่านแล้ว 7% | Chapter 7 · 7% read | ຕອນທີ 7 · ອ່ານແລ້ວ 7% |
| `continueRow.progressLabel` | ความคืบหน้าการอ่าน | Reading progress | ຄວາມຄືບໜ້າການອ່ານ |
| `draft.label` | ร่าง — เห็นเฉพาะผู้ดูแล | Draft — visible to admins only | ຮ່າງ — ເຫັນສະເພາະຜູ້ດູແລ |
| `draft.short` | ร่าง | Draft | ຮ່າງ |
| `novel.by` | โดย | by | ໂດຍ |
| `novel.ongoing` | ยังไม่จบ | Ongoing | ຍັງບໍ່ຈົບ |
| `novel.completed` | จบแล้ว | Completed | ຈົບແລ້ວ |
| `novel.chapters` | 7 ตอน | 7 chapters | 7 ຕອນ |
| `novel.updated` | อัปเดต 7 | Updated 7 | ອັບເດດ 7 |
| `novel.latest` | ตอนล่าสุด | Latest chapter | ຕອນຫຼ້າສຸດ |
| `novel.latestSr` | (ตอนที่ 7) | (chapter 7) | (ຕອນທີ 7) |
| `synopsis.title` | เรื่องย่อ | Synopsis | ເລື່ອງຫຍໍ້ |
| `synopsis.less` | ย่อ | Show less | ຫຍໍ້ |
| `synopsis.more` | อ่านเพิ่ม | Read more | ອ່ານເພີ່ມ |
| `credit.title` | เครดิตและที่มา | Credits and source | ເຄຣດິດ ແລະ ແຫຼ່ງທີ່ມາ |
| `credit.author` | ผู้แต่ง | Author | ຜູ້ແຕ່ງ |
| `credit.source` | ต้นฉบับ | Original | ຕົ້ນສະບັບ |
| `credit.license` | บันทึกสิทธิ์ | Rights note | ບັນທຶກສິດ |
| `credit.notSpecified` | ไม่ระบุ | Not specified | ບໍ່ລະບຸ |
| `credit.newTab` | (เปิดในแท็บใหม่) | (opens in a new tab) | (ເປີດໃນແທັບໃໝ່) |
| `credit.aiBadge` | แปลโดย AI (Claude) — อาจมีข้อผิดพลาด | Translated by AI (Claude) — may contain errors | ແປໂດຍ AI (Claude) — ອາດມີຂໍ້ຜິດພາດ |
| `credit.report` | แจ้งลบเนื้อหา | Report content for removal | ແຈ້ງລຶບເນື້ອຫາ |
| `chapters.title` | รายการตอน | Chapters | ລາຍການຕອນ |
| `chapters.empty` | ยังไม่มีตอนให้อ่าน | No chapters to read yet | ຍັງບໍ່ມີຕອນໃຫ້ອ່ານ |
| `chapters.orderGroup` | เรียงตอน | Chapter order | ຮຽງຕອນ |
| `chapters.orderNewest` | ใหม่ → เก่า | Newest → oldest | ໃໝ່ → ເກົ່າ |
| `chapters.orderOldest` | เก่า → ใหม่ | Oldest → newest | ເກົ່າ → ໃໝ່ |
| `chapters.jumpLabel` | ไปตอนที่ | Go to chapter | ໄປຕອນທີ |
| `chapters.jumpGo` | ไป | Go | ໄປ |
| `chapters.chapterN` | ตอนที่ 7 | Chapter 7 | ຕອນທີ 7 |
| `chapters.lastRead` | อ่านล่าสุด | Last read | ອ່ານຫຼ້າສຸດ |
| `chapters.pagerLabel` | หน้ารายการตอน | Chapter list pages | ໜ້າລາຍການຕອນ |
| `chapters.prev` | ก่อนหน้า | Previous | ກ່ອນໜ້າ |
| `chapters.next` | ถัดไป | Next | ຖັດໄປ |
| `chapters.pageInfo` | หน้า 7 จาก 7 · ตอนที่ 7 | Page 7 of 7 · Chapters 7 | ໜ້າ 7 ຈາກ 7 · ຕອນທີ 7 |
| `chapters.jumpNone` | ยังไม่มีตอนให้ไป | There are no chapters to go to yet | ຍັງບໍ່ມີຕອນໃຫ້ໄປ |
| `chapters.jumpEmpty` | กรอกเลขตอนที่ต้องการ | Enter the chapter number you want | ໃສ່ເລກຕອນທີ່ຕ້ອງການ |
| `chapters.jumpNotNumber` | กรอกเลขตอนเป็นตัวเลข เช่น 12 | Enter the chapter as a number, e.g. 12 | ໃສ່ເລກຕອນເປັນຕົວເລກ ເຊັ່ນ 12 |
| `chapters.jumpMissing` | ไม่พบตอนที่ 7 (มีตั้งแต่ตอนที่ 7 ถึง 7) | Chapter 7 not found (available: chapters 7 to 7) | ບໍ່ພົບຕອນທີ 7 (ມີຕັ້ງແຕ່ຕອນທີ 7 ເຖິງ 7) |
| `chapters.readStart` | เริ่มอ่าน | Start reading | ເລີ່ມອ່ານ |
| `chapters.readResume` | อ่านต่อ ตอนที่ 7 | Continue · Chapter 7 | ອ່ານຕໍ່ ຕອນທີ 7 |
| `chapters.readReread` | อ่านซ้ำ ตอนที่ 7 | Reread · Chapter 7 | ອ່ານຊ້ຳ ຕອນທີ 7 |
| `reader.headingBare` | ตอนที่ 7 | Chapter 7 | ຕອນທີ 7 |
| `reader.headingNamed` | ตอนที่ 7: 7 | Chapter 7: 7 | ຕອນທີ 7: 7 |
| `reader.empty` | ตอนนี้ยังไม่มีเนื้อหา | This chapter has no content yet. | ຕອນນີ້ຍັງບໍ່ມີເນື້ອຫາ |
| `reader.navLabel` | เปลี่ยนตอน | Change chapter | ປ່ຽນຕອນ |
| `reader.prev` | ตอนก่อนหน้า | Previous chapter | ຕອນກ່ອນໜ້າ |
| `reader.noPrev` | ไม่มีตอนก่อนหน้า | No previous chapter | ບໍ່ມີຕອນກ່ອນໜ້າ |
| `reader.toc` | สารบัญ | Contents | ສາລະບານ |
| `reader.next` | ตอนถัดไป | Next chapter | ຕອນຖັດໄປ |
| `reader.noNext` | ยังไม่มีตอนถัดไป | No next chapter yet | ຍັງບໍ່ມີຕອນຖັດໄປ |
| `reader.bar.progress` | อ่านไปแล้ว | Read so far | ອ່ານໄປແລ້ວ |
| `reader.bar.back` | กลับไปหน้านิยาย | Back to the novel page | ກັບໄປໜ້ານິຍາຍ |
| `reader.bar.chapter` | ตอนที่ 7 | Chapter 7 | ຕອນທີ 7 |
| `reader.bar.toc` | สารบัญตอน | Chapter list | ສາລະບານຕອນ |
| `reader.bar.stopListen` | หยุดฟัง | Stop listening | ຢຸດຟັງ |
| `reader.bar.listen` | ฟังเสียงอ่าน | Listen | ຟັງສຽງອ່ານ |
| `reader.bar.settings` | ตั้งค่าการอ่าน | Reading settings | ຕັ້ງຄ່າການອ່ານ |
| `reader.bar.player` | ควบคุมเสียงอ่าน | Audio controls | ຄວບຄຸມສຽງອ່ານ |
| `reader.bar.prevPara` | ย่อหน้าก่อนหน้า | Previous paragraph | ວັກກ່ອນໜ້າ |
| `reader.bar.resume` | เล่นต่อ | Resume | ຫຼິ້ນຕໍ່ |
| `reader.bar.pause` | หยุดชั่วคราว | Pause | ຢຸດຊົ່ວຄາວ |
| `reader.bar.nextPara` | ย่อหน้าถัดไป | Next paragraph | ວັກຖັດໄປ |
| `reader.bar.speed` | ความเร็ว | Speed | ຄວາມໄວ |
| `reader.bar.rateValue` | 7.0 เท่า | 7.0× speed | 7.0 ເທົ່າ |
| `settings.title` | ตั้งค่าการอ่าน | Reading settings | ຕັ້ງຄ່າການອ່ານ |
| `settings.close` | ปิดการตั้งค่า | Close settings | ປິດການຕັ້ງຄ່າ |
| `settings.theme` | ธีม | Theme | ສີສັນ |
| `settings.fontSize` | ขนาดตัวอักษร | Font size | ຂະໜາດຕົວອັກສອນ |
| `settings.sizeGlyph` | ก | A | ກ |
| `settings.sizeValue` | 7 พิกเซล | 7 px | 7 ພິກເຊວ |
| `settings.font` | ฟอนต์ | Font | ຟອນ |
| `settings.voiceMissing` | เครื่องหรือเบราว์เซอร์นี้ยังไม่มีเสียงอ่านภาษาไทย จึงไม่มีปุ่มฟัง — ลองเปิดจากอุปกรณ์ที่ติดตั้งเสียงภาษาไทยไว้ | This device or browser has no Thai voice, so there is no listen button — try a device with a Thai voice installed. | ເຄື່ອງ ຫຼື ບຣາວເຊີນີ້ຍັງບໍ່ມີສຽງອ່ານພາສາໄທ ຈຶ່ງບໍ່ມີປຸ່ມຟັງ — ລອງເປີດຈາກອຸປະກອນທີ່ຕິດຕັ້ງສຽງພາສາໄທໄວ້ |
| `about.aboutTitle` | เกี่ยวกับเว็บนี้ | About this site | ກ່ຽວກັບເວັບນີ້ |
| `about.aboutEmptyTitle` | ยังไม่มีข้อความแนะนำเว็บ | No site introduction yet | ຍັງບໍ່ມີຂໍ້ຄວາມແນະນຳເວັບ |
| `about.aboutEmptyHint` | เจ้าของเว็บยังไม่ได้เขียนข้อความในหน้านี้ | The site owner hasn't written anything on this page yet. | ເຈົ້າຂອງເວັບຍັງບໍ່ໄດ້ຂຽນຂໍ້ຄວາມໃນໜ້ານີ້ |
| `about.contactTitle` | ติดต่อ / แจ้งลบเนื้อหา | Contact / report content for removal | ຕິດຕໍ່ / ແຈ້ງລຶບເນື້ອຫາ |
| `about.contactEmptyTitle` | ยังไม่มีช่องทางติดต่อ | No contact information yet | ຍັງບໍ່ມີຊ່ອງທາງຕິດຕໍ່ |
| `about.contactEmptyHint` | เว็บนี้เป็นนิยายที่แปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม ผู้ถือสิทธิ์ที่ต้องการแจ้งลบหรือแก้ไขเนื้อหาให้ติดต่อเจ้าของเว็บ แต่ตอนนี้เจ้าของเว็บยังไม่ได้ระบุช่องทางติดต่อไว้ในหน้านี้ | The novels on this site are translated by AI and the rights to the content belong to the original authors. Rights holders who want content removed or corrected should contact the site owner, but the owner hasn't listed a contact method on this page yet. | ເວັບນີ້ເປັນນິຍາຍທີ່ແປໂດຍ AI ສິດໃນເນື້ອຫາເປັນຂອງເຈົ້າຂອງຜົນງານເດີມ ຜູ້ຖືສິດທີ່ຕ້ອງການແຈ້ງລຶບ ຫຼື ແກ້ໄຂເນື້ອຫາໃຫ້ຕິດຕໍ່ເຈົ້າຂອງເວັບ ແຕ່ຕອນນີ້ເຈົ້າຂອງເວັບຍັງບໍ່ໄດ້ລະບຸຊ່ອງທາງຕິດຕໍ່ໄວ້ໃນໜ້ານີ້ |

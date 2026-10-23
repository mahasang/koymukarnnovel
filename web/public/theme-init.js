// ตั้งธีมที่ผู้อ่านเลือกไว้ก่อนวาดหน้า (กันจอวาบ) · ชื่อธีมต้องตรงกับ src/lib/theme.ts
(function () {
  try {
    var t = localStorage.getItem("koymukarnnovel.theme");
    if (["midnight", "paper", "sepia", "black"].indexOf(t) !== -1) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();

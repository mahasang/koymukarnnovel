import { useEffect, useRef, type RefObject } from "react"

/** `ref.current` เป็น true ตั้งแต่หน้าติดตั้งจนถูกถอด — ไว้เช็กก่อนตั้ง state หลัง `await` (คำขอที่ตอบกลับมาหลังออกจากหน้าไปแล้ว) */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}

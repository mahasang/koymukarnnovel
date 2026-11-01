/**
 * ช่องค้นหาบนแถบบน: พิมพ์แล้วกด Enter ไปที่หน้าแรกพร้อมคำค้น (`/?q=…`) — หน้าแรกกรองรายการเอง
 * `SearchBoxView` ไม่มี state (ทดสอบง่าย) · `SearchBox` จำข้อความที่พิมพ์และพาไปหน้าผลลัพธ์
 */
import { Search } from "lucide-react"
import { useRef, useState, type Ref } from "react"
import { useNavigate } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { MESSAGES, type Messages } from "../i18n/messages"
import { SEARCH_MAX_LENGTH, searchPath } from "../lib/search"

export interface SearchBoxViewProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef?: Ref<HTMLInputElement>
  /** ชุดข้อความ — ไม่ส่ง = ภาษาไทย (ไม่ใช้ hook เพื่อให้เทสต์เรียกเป็นฟังก์ชันตรงๆ ได้) */
  m?: Messages
}

export function SearchBoxView({ value, onChange, onSubmit, inputRef, m = MESSAGES.th }: SearchBoxViewProps) {
  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Search aria-hidden="true" size={17} />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={m.search.placeholder}
        aria-label={m.search.label}
        maxLength={SEARCH_MAX_LENGTH}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
    </form>
  )
}

export function SearchBox({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { m } = useI18n()
  return (
    <SearchBoxView
      value={value}
      onChange={setValue}
      inputRef={inputRef}
      m={m}
      onSubmit={() => {
        navigate(searchPath(value))
        inputRef.current?.blur() // มือถือ: เก็บแป้นพิมพ์ให้เห็นผลลัพธ์
      }}
    />
  )
}

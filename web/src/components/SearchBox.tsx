/**
 * ช่องค้นหาบนแถบบน: พิมพ์แล้วกด Enter ไปที่หน้าแรกพร้อมคำค้น (`/?q=…`) — หน้าแรกกรองรายการเอง
 * `SearchBoxView` ไม่มี state (ทดสอบง่าย) · `SearchBox` จำข้อความที่พิมพ์และพาไปหน้าผลลัพธ์
 */
import { Search } from "lucide-react"
import { useRef, useState, type Ref } from "react"
import { useNavigate } from "react-router"
import { SEARCH_MAX_LENGTH, searchPath } from "../lib/search"

export interface SearchBoxViewProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef?: Ref<HTMLInputElement>
}

export function SearchBoxView({ value, onChange, onSubmit, inputRef }: SearchBoxViewProps) {
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
        placeholder="ค้นหาชื่อเรื่อง ผู้แต่ง หมวดหมู่…"
        aria-label="ค้นหานิยาย"
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
  return (
    <SearchBoxView
      value={value}
      onChange={setValue}
      inputRef={inputRef}
      onSubmit={() => {
        navigate(searchPath(value))
        inputRef.current?.blur() // มือถือ: เก็บแป้นพิมพ์ให้เห็นผลลัพธ์
      }}
    />
  )
}

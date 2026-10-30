/**
 * ช่องกรอกแท็ก (spec 7.4): พิมพ์แล้วกด Enter · วางหลายอันคั่นด้วยจุลภาคได้ · ออกจากช่องแล้วเพิ่มที่ค้างอยู่ให้ · ลบด้วยปุ่ม ×
 * `TagInputView` เป็นส่วนแสดงผลล้วน (เทสต์ด้วยการเรียกตรงๆ) · `TagInput` ถือข้อความที่กำลังพิมพ์กับข้อความ "เพิ่มไม่ได้เพราะ…"
 * กฎการเพิ่ม (ซ้ำ ยาวเกิน เกิน 12 อัน) อยู่ใน `addTags` (novel-logic.ts)
 */
import { X } from "lucide-react"
import { useState } from "react"
import { addTags, MAX_TAGS, removeTag } from "./novel-logic"

export type TagKeyAction = "commit" | "ignore" | null

/**
 * Enter เพิ่มแท็ก · แต่ Enter ที่กดเพื่อยืนยันคำจากแป้นพิมพ์ภาษา (กำลังเรียบเรียงคำ: `isComposing`, หรือ `keyCode` 229 ที่ Safari ส่งมา) ต้องปล่อยผ่าน
 * ไม่งั้นแท็กจะถูกเพิ่มทั้งที่ยังพิมพ์ไม่จบ
 */
export function tagKeyAction(e: { key: string; isComposing: boolean; keyCode: number }): TagKeyAction {
  if (e.key !== "Enter") return null
  return e.isComposing || e.keyCode === 229 ? "ignore" : "commit"
}

export interface TagInputViewProps {
  id: string
  hintId: string
  errorId: string
  tags: string[]
  text: string
  problem: string | null
  onText(value: string): void
  onCommit(): void
  onRemove(index: number): void
}

export function TagInputView(p: TagInputViewProps) {
  return (
    <div className="ad-tags">
      {p.tags.length > 0 && (
        <ul className="ad-tag-list" aria-label="แท็กที่ใส่แล้ว">
          {p.tags.map((tag, index) => (
            <li key={tag} className="ad-tag">
              <span>{tag}</span>
              <button type="button" className="ad-tag-x" aria-label={`ลบแท็ก ${tag}`} onClick={() => p.onRemove(index)}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={p.id}
        type="text"
        className="ad-tag-input"
        autoComplete="off"
        maxLength={400}
        placeholder="เช่น แฟนตาซี"
        value={p.text}
        aria-invalid={p.problem !== null ? true : undefined}
        aria-describedby={p.problem !== null ? `${p.hintId} ${p.errorId}` : p.hintId}
        onChange={(event) => p.onText(event.target.value)}
        onKeyDown={(event) => {
          const action = tagKeyAction({ key: event.key, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })
          if (action !== "commit") return
          event.preventDefault() // ไม่ให้ Enter ในช่องนี้ส่งทั้งฟอร์ม
          p.onCommit()
        }}
        onBlur={() => p.onCommit()}
      />
      <p id={p.hintId} className="ad-hint">{`${p.tags.length}/${MAX_TAGS} อัน · พิมพ์แล้วกด Enter (วางหลายอันคั่นด้วยจุลภาคได้)`}</p>
      {p.problem !== null && (
        <p id={p.errorId} className="ad-field-error" role="alert">
          {p.problem}
        </p>
      )}
    </div>
  )
}

export function TagInput({ id, tags, onChange }: { id: string; tags: string[]; onChange(tags: string[]): void }) {
  const [text, setText] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  function commit(): void {
    const out = addTags(tags, text)
    setProblem(out.problem)
    if (out.problem !== null) return // ข้อความค้างไว้ให้แก้แล้วลองใหม่
    setText("")
    if (out.tags.length !== tags.length) onChange(out.tags)
  }

  return (
    <TagInputView
      id={id}
      hintId={`${id}-hint`}
      errorId={`${id}-error`}
      tags={tags}
      text={text}
      problem={problem}
      onText={(value) => {
        setText(value)
        setProblem(null)
      }}
      onCommit={commit}
      onRemove={(index) => onChange(removeTag(tags, index))}
    />
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "tdesign-react";

export const MAX_INPUT_LENGTH = 2000;

export interface ComposerProps {
  sessionId: string;
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
  disabledPlaceholder?: string;
  onSend: (question: string) => void;
  onDraftChange?: (draft: string) => void;
  draftStore?: DraftStore;
}

export interface DraftStore {
  read: (sessionId: string) => string;
  write: (sessionId: string, draft: string) => void;
  clear: (sessionId: string) => void;
}

export function draftKey(sessionId: string): string {
  return `assistant:draft:${sessionId}`;
}

export const sessionStorageDraftStore: DraftStore = {
  read(sessionId) {
    try {
      return window.sessionStorage.getItem(draftKey(sessionId)) ?? "";
    } catch {
      return "";
    }
  },
  write(sessionId, draft) {
    try {
      if (draft.length === 0) window.sessionStorage.removeItem(draftKey(sessionId));
      else window.sessionStorage.setItem(draftKey(sessionId), draft);
    } catch {
      // Private-mode quota errors must not break typing.
    }
  },
  clear(sessionId) {
    try {
      window.sessionStorage.removeItem(draftKey(sessionId));
    } catch {
      /* ignored */
    }
  },
};

/** Chinese text counts by code point so emoji and CJK are one character each. */
export function charCount(value: string): number {
  return Array.from(value).length;
}

export function isBlank(value: string): boolean {
  // Half-width spaces, full-width spaces (U+3000) and line breaks are all blank.
  return value.replace(/[\s\u3000]/g, "").length === 0;
}

export default function Composer({
  sessionId,
  disabled = false,
  disabledHint = "助手已暂停使用",
  placeholder = "输入问题，Enter 发送，Shift+Enter 换行",
  disabledPlaceholder = "助手已暂停使用，暂时无法提问",
  onSend,
  onDraftChange,
  draftStore = sessionStorageDraftStore,
}: ComposerProps) {
  const [value, setValueState] = useState<string>(() => draftStore.read(sessionId));
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setValueState(draftStore.read(sessionId));
  }, [draftStore, sessionId]);

  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      draftStore.write(sessionId, next);
      onDraftChange?.(next);
    },
    [draftStore, onDraftChange, sessionId],
  );

  const count = charCount(value);
  const tooLong = count > MAX_INPUT_LENGTH;
  const blank = isBlank(value);
  const canSend = !disabled && !tooLong && !blank;

  const submit = useCallback(() => {
    if (!canSend) return;
    const question = value;
    draftStore.clear(sessionId);
    setValueState("");
    onDraftChange?.("");
    onSend(question);
  }, [canSend, draftStore, onDraftChange, onSend, sessionId, value]);

  // Over-length text is kept as typed: the counter turns red, the inline warning
  // appears and the send button is disabled, so an accidental long paste is never
  // silently trimmed under the user's cursor.
  const handleChange = useCallback((next: string) => setValue(next), [setValue]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey) return;
      // Two paths guard the IME: the React state set by composition events and the
      // browser-native flag carried on the keydown itself.
      if (composing || composingRef.current || event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      // Over-length input keeps its inline warning and the disabled send button,
      // so Enter is a no-op until the text is trimmed back under the limit.
      if (tooLong) return;
      submit();
    },
    [composing, submit, tooLong],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    setComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    setComposing(false);
  }, []);

  const counter = useMemo(() => {
    const tone = tooLong ? "assistant-composer__counter--error" : "";
    return (
      <span className={`assistant-composer__counter ${tone}`} data-testid="char-counter">
        {count}/{MAX_INPUT_LENGTH}
      </span>
    );
  }, [count, tooLong]);

  return (
    <div className="assistant-composer" data-testid="composer">
      <textarea
        ref={textareaRef}
        className="assistant-composer__input"
        data-testid="composer-input"
        rows={3}
        value={value}
        disabled={disabled}
        placeholder={disabled ? disabledPlaceholder : placeholder}
        aria-label="向 AI 助手提问"
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      <div className="assistant-composer__footer">
        {tooLong ? (
          <span className="assistant-composer__hint" data-testid="length-warning">
            已超出 {MAX_INPUT_LENGTH} 字上限，请删减后再发送
          </span>
        ) : (
          <span className="assistant-composer__hint">Enter 发送 · Shift+Enter 换行</span>
        )}
        {counter}
        <Button
          theme="primary"
          size="small"
          data-testid="send-button"
          aria-disabled={!canSend}
          disabled={!canSend}
          onClick={submit}
        >
          发送
        </Button>
      </div>
      {disabled ? (
        <p className="assistant-composer__paused" data-testid="paused-notice">
          {disabledHint}
        </p>
      ) : null}
    </div>
  );
}


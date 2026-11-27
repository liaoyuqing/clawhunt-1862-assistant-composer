import { Button } from "tdesign-react";

export interface StopButtonProps {
  visible: boolean;
  onStop: () => void;
}

export default function StopButton({ visible, onStop }: StopButtonProps) {
  if (!visible) return null;
  return (
    <div className="assistant-stop" data-testid="stop-bar">
      <span className="assistant-stop__hint">助手正在生成…</span>
      <Button
        theme="default"
        variant="outline"
        size="small"
        data-testid="stop-button"
        onClick={onStop}
      >
        停止
      </Button>
    </div>
  );
}


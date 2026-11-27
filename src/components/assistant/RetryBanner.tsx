import { Button } from "tdesign-react";
import type { StreamError } from "../../hooks/useAssistantStream";

export interface RetryBannerProps {
  error: StreamError | null;
  attempt: number;
  retrying: boolean;
  /** False while the assistant is paused: reconnecting would only fail again. */
  retryable?: boolean;
  onRetry: () => void;
}

export default function RetryBanner({
  error,
  attempt,
  retrying,
  retryable = true,
  onRetry,
}: RetryBannerProps) {
  if (retrying) {
    return (
      <div className="assistant-retry assistant-retry--retrying" data-testid="retrying-banner">
        连接中断，正在第 {attempt} 次自动重连…
      </div>
    );
  }
  if (!error) return null;
  return (
    <div className="assistant-retry assistant-retry--failed" data-testid="retry-banner" role="alert">
      <span className="assistant-retry__text">
        {error.message}（{error.code}）
      </span>
      {retryable ? (
        <Button
          theme="primary"
          variant="outline"
          size="small"
          data-testid="retry-button"
          onClick={onRetry}
        >
          重试
        </Button>
      ) : null}
    </div>
  );
}


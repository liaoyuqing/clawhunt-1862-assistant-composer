import { useState } from "react";
import { Button, Layout } from "tdesign-react";
import AssistantChat from "./components/assistant/AssistantChat";

const { Header, Content } = Layout;

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [sessionId, setSessionId] = useState("spaces-101");

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-header__brand">星澜科技 · 会员空间平台（演示数据）</div>
        <div className="app-header__actions">
          <Button size="small" data-testid="toggle-panel" onClick={() => setPanelOpen((open) => !open)}>
            {panelOpen ? "关闭助手" : "打开助手"}
          </Button>
          <Button
            size="small"
            variant="outline"
            data-testid="switch-session"
            onClick={() => setSessionId((id) => (id === "spaces-101" ? "spaces-202" : "spaces-101"))}
          >
            切换会话
          </Button>
        </div>
      </Header>
      <Content className="app-content">
        <div className="app-panel">
          <h1>工作台</h1>
          <p>会员企业 100 家 · 当前会话 {sessionId}</p>
          <p>本页面所有企业名称、会员编号与资料均为虚构演示数据。</p>
        </div>
        <aside className="app-aside">
          <AssistantChat sessionId={sessionId} panelOpen={panelOpen} />
        </aside>
      </Content>
    </Layout>
  );
}


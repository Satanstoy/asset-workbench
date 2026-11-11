"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, jsonPost } from "@/lib/api";
import type { Session, User } from "@/lib/api";

type SessionState = { user: User | null; busy: boolean; epoch: number; error: string };
type Identity = SessionState & {
  openAccount: () => void;
  expire: (epoch: number) => void;
  verify: (epoch: number, userId: string, signal: AbortSignal) => Promise<boolean>;
};

const SessionContext = createContext<Identity | null>(null);

export function useIdentity() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("缺少演示身份上下文");
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ user: null, busy: true, epoch: 0, error: "" });
  const sequence = useRef(0);
  const selection = useRef(false);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = sequence.current;
    api<Session>("/api/session", { signal: controller.signal }).then(
      ({ user }) => {
        if (!controller.signal.aborted && sequence.current === epoch) {
          setState({ user, busy: false, epoch, error: "" });
        }
      },
      () => {
        if (!controller.signal.aborted && sequence.current === epoch) {
          setState({ user: null, busy: false, epoch, error: "暂时无法读取演示身份，请重新选择" });
        }
      },
    );
    return () => controller.abort();
  }, []);

  async function choose(id: string) {
    if (selection.current || state.user?.id === id) return;
    selection.current = true;
    const epoch = ++sequence.current;
    setState({ user: null, busy: true, epoch, error: "" });
    try {
      const { user } = await api<Session>("/api/session", jsonPost({ userId: id }));
      if (epoch === sequence.current) setState({ user, busy: false, epoch, error: "" });
    } catch {
      const actual = await api<Session>("/api/session").catch(() => null);
      if (epoch === sequence.current) {
        setState({
          user: actual?.user ?? null, busy: false, epoch,
          error: actual?.user?.id === id ? "" : "暂时无法切换身份，请重试",
        });
      }
    } finally {
      selection.current = false;
    }
  }

  const expire = useCallback((epoch: number) => {
    if (sequence.current !== epoch) return;
    const next = ++sequence.current;
    setState({ user: null, busy: false, epoch: next, error: "会话已失效，请重新选择演示身份" });
  }, []);

  const verify = useCallback(async (epoch: number, userId: string, signal: AbortSignal) => {
    const { user } = await api<Session>("/api/session", { signal });
    if (signal.aborted || epoch !== sequence.current) return false;
    if (user?.id === userId) return true;
    const next = ++sequence.current;
    setState({ user, busy: false, epoch: next, error: "" });
    return false;
  }, []);

  function openAccount() {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    accountDialog.current?.showModal();
  }
  const initial = state.user ? state.user.id.slice(-1).toUpperCase() : "•";

  return (
    <SessionContext.Provider value={{ ...state, openAccount, expire, verify }}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">素材制作工作台</Link>
          <nav aria-label="主导航"><Link href="/">模板列表</Link><Link href="/history">个人历史</Link></nav>
          <button className="account-trigger" ref={accountButton} type="button" aria-label="账户设置"
            onClick={openAccount}>
            <span className="account-avatar" aria-hidden="true">{initial}</span>
            {state.busy ? "正在确认身份…" : state.user?.displayName ?? "选择演示身份"}
          </button>
        </div>
        {state.error && <p className="identity-error" role="status">{state.error}</p>}
      </header>
      <dialog className="account-dialog" ref={accountDialog} aria-labelledby="account-title"
        onClose={() => (previousFocus.current?.isConnected ? previousFocus.current : accountButton.current)?.focus()}>
        <div className="section-heading">
          <h2 id="account-title">账户设置</h2>
          <button type="button" aria-label="关闭账户设置" onClick={() => accountDialog.current?.close()}>×</button>
        </div>
        <div className="account-profile" role="status">
          <span className="account-avatar" aria-hidden="true">{initial}</span>
          <strong>{state.busy ? "正在确认身份…" : state.user ? `当前：${state.user.displayName}` : "尚未选择演示身份"}</strong>
        </div>
        <fieldset className="account-options" disabled={state.busy}>
          <legend>选择演示身份</legend>
          <p>每个身份有独立的素材和制作记录。切换后可在个人历史核对。</p>
          {["A", "B"].map((letter) => (
            <button type="button" key={letter} aria-pressed={state.user?.id === `demo-${letter.toLowerCase()}`}
              onClick={() => void choose(`demo-${letter.toLowerCase()}`)}>演示用户 {letter}</button>
          ))}
        </fieldset>
        {state.error && <p className="error" role="status">{state.error}</p>}
      </dialog>
      {children}
    </SessionContext.Provider>
  );
}

"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, jsonPost } from "@/lib/api";
import type { Session, User } from "@/lib/api";

type SessionState = { user: User | null; busy: boolean; epoch: number; error: string };
type Identity = SessionState & {
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

  return (
    <SessionContext.Provider value={{ ...state, expire, verify }}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">素材制作工作台</Link>
          <nav aria-label="主导航"><Link href="/">模板列表</Link><Link href="/history">个人历史</Link></nav>
          <div className="identity" aria-label="选择演示身份">
            <span>{state.busy ? "正在确认身份…" : state.user ? `当前：${state.user.displayName}` : "选择演示身份"}</span>
            {["A", "B"].map((letter) => (
              <button
                type="button" key={letter} disabled={state.busy} aria-pressed={state.user?.id === `demo-${letter.toLowerCase()}`}
                onClick={() => void choose(`demo-${letter.toLowerCase()}`)}
              >演示用户 {letter}</button>
            ))}
          </div>
        </div>
        {state.error && <p className="identity-error" role="status">{state.error}</p>}
      </header>
      {children}
    </SessionContext.Provider>
  );
}

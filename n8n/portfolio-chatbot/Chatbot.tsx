import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Bot, 
  Send, 
  X, 
  Sparkles, 
  RotateCcw, 
  User, 
  Loader2, 
  ChevronDown,
  ExternalLink
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const DEFAULT_WEBHOOK_URL = "https://n8n.curator.io.vn/webhook/portfolio-chat";

const SUGGESTIONS = [
  "🔍 SearXNG: Xu hướng công nghệ Cloud & AI 2026",
  "☁️ Làm sao tối ưu chi phí Google Cloud Run về 0đ?",
  "⚡ Kubernetes vs Docker Swarm: Khi nào nên chọn?",
  "💡 Giới thiệu các kinh nghiệm nổi bật của Long Nguyễn"
];

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let sid = localStorage.getItem("portfolio_chat_session_id");
    if (!sid) {
      sid = "sess-" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem("portfolio_chat_session_id", sid);
    }
    setSessionId(sid);

    const savedMessages = localStorage.getItem("portfolio_chat_messages");
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch {
        // Fallback to empty if parse fails
      }
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("portfolio_chat_messages", JSON.stringify(messages));
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, statusMessage]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleResetChat = () => {
    const newSid = "sess-" + Math.random().toString(36).substring(2, 11);
    setSessionId(newSid);
    localStorage.setItem("portfolio_chat_session_id", newSid);
    localStorage.removeItem("portfolio_chat_messages");
    setMessages([]);
    setStatusMessage("");
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMessage: Message = {
      id: "usr-" + Date.now(),
      role: "user",
      content: query,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStatusMessage("Đang kết nối AI & SearXNG...");

    const coldStartTimer = setTimeout(() => {
      setStatusMessage("Đang khởi động n8n Cloud Run & truy vấn SearXNG (~10s)...");
    }, 3500);

    const webhookUrl = (import.meta as any).env?.VITE_N8N_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: query,
          sessionId: sessionId
        })
      });

      clearTimeout(coldStartTimer);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const replyContent = data.reply || data.output || data.message || "Xin lỗi, không nhận được phản hồi hợp lệ từ n8n.";

      const assistantMessage: Message = {
        id: "ast-" + Date.now(),
        role: "assistant",
        content: replyContent,
        timestamp: new Date()
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      clearTimeout(coldStartTimer);
      const errorMessage: Message = {
        id: "err-" + Date.now(),
        role: "assistant",
        content: `⚠️ Không thể kết nối tới n8n Workflow (${err?.message || "Lỗi mạng"}).\n\nVui lòng kiểm tra xem workflow đã được Active trên n8n và cấu hình Webhook URL chính xác chưa.`,
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setStatusMessage("");
    }
  };

  const renderTextWithFormatting = (text: string, keyPrefix: string) => {
    const boldRegex = /\*\*([^*]+)\*\*/g;
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let bMatch: RegExpExecArray | null;

    while ((bMatch = boldRegex.exec(text)) !== null) {
      if (bMatch.index > lastIdx) {
        parts.push(text.substring(lastIdx, bMatch.index));
      }
      parts.push(
        <strong key={`${keyPrefix}-b-${bMatch.index}`} className="font-semibold text-slate-900 dark:text-white">
          {bMatch[1]}
        </strong>
      );
      lastIdx = boldRegex.lastIndex;
    }
    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }
    return <React.Fragment key={keyPrefix}>{parts}</React.Fragment>;
  };

  const renderInlineContent = (text: string) => {
    const linkRegex = /(?:\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)|<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>|(https?:\/\/[^\s<]+))/gi;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(renderTextWithFormatting(text.substring(lastIndex, match.index), `txt-${lastIndex}`));
      }

      const label = match[1] || match[4] || match[5];
      const url = match[2] || match[3] || match[5];

      elements.push(
        <a
          key={`link-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-sky-600 dark:text-sky-400 underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300 hover:decoration-sky-500 transition-all bg-sky-500/10 dark:bg-sky-400/10 px-1.5 py-0.5 rounded-md mx-0.5 my-0.5 break-all cursor-pointer shadow-xs group"
          title={`Mở liên kết trong tab mới: ${url}`}
        >
          <span className="group-hover:underline">{label}</span>
          <ExternalLink className="w-3 h-3 inline-block shrink-0 stroke-[2.2] opacity-80 group-hover:opacity-100 transition-opacity" />
        </a>
      );

      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      elements.push(renderTextWithFormatting(text.substring(lastIndex), `txt-${lastIndex}`));
    }

    return elements;
  };

  const renderFormattedContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed === "---" || trimmed === "***") {
        return <hr key={idx} className="my-2 border-slate-200 dark:border-slate-700" />;
      }
      if (trimmed.startsWith("### ")) {
        return (
          <h4 key={idx} className="font-bold text-sm text-slate-900 dark:text-white mt-2 mb-1">
            {renderInlineContent(trimmed.replace("### ", ""))}
          </h4>
        );
      }
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return (
          <li key={idx} className="ml-4 list-disc text-xs text-slate-700 dark:text-slate-300 my-0.5">
            {renderInlineContent(trimmed.substring(2))}
          </li>
        );
      }
      if (!trimmed) {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p key={idx} className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed my-1">
          {renderInlineContent(line)}
        </p>
      );
    });
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <div className="fixed bottom-8 right-8 z-50">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(!isOpen)}
          className="relative group p-4 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-[0_10px_25px_rgba(14,165,233,0.35)] hover:shadow-[0_12px_30px_rgba(14,165,233,0.5)] transition-all flex items-center justify-center focus:outline-none"
          aria-label="Open AI Chat"
        >
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-slate-900"></span>
          </span>

          <AnimatePresence mode="wait">
            {isOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X className="w-6 h-6 stroke-[2.2]" />
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2"
              >
                <Bot className="w-6 h-6" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Chat Window Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.92 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-4 sm:right-8 z-50 w-[92vw] sm:w-[420px] h-[580px] max-h-[80vh] rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">AI Assistant</span>
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Online
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Powered by n8n & SearXNG Search
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleResetChat}
                  title="Xóa cuộc trò chuyện"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  title="Đóng chat"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-center p-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-950/60 text-sky-500 flex items-center justify-center mb-3">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
                    Xin chào!
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 max-w-xs leading-relaxed">
                    Mình là trợ lý AI thông minh được kết nối trực tiếp với n8n Workflow và SearXNG để tra cứu web realtime.
                  </p>

                  <div className="w-full space-y-2 mt-2">
                    <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider text-left">Gợi ý câu hỏi:</p>
                    {SUGGESTIONS.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(item)}
                        className="w-full text-left text-xs p-2.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-sky-50 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white mt-1">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs ${
                        msg.role === "user"
                          ? "bg-gradient-to-r from-sky-500 to-sky-600 text-white rounded-br-none shadow-sm"
                          : "bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 rounded-bl-none shadow-sm"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        renderFormattedContent(msg.content)
                      )}
                      <div
                        className={`text-[9px] mt-1 text-right ${
                          msg.role === "user" ? "text-sky-200" : "text-slate-400 dark:text-slate-500"
                        }`}
                      >
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>

                    {msg.role === "user" && (
                      <div className="w-7 h-7 rounded-xl bg-slate-200 dark:bg-slate-700 flex-shrink-0 flex items-center justify-center text-slate-600 dark:text-slate-300 mt-1">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {isLoading && (
                <div className="flex gap-2.5 items-start">
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white mt-1">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 rounded-2xl rounded-bl-none px-4 py-3 flex flex-col gap-1.5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500" />
                      <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                        {statusMessage || "Đang xử lý..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-200/60 dark:border-slate-700/60">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Nhập câu hỏi hoặc yêu cầu tra cứu..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-2xl bg-sky-500 text-white hover:bg-sky-600 active:scale-95 disabled:opacity-40 disabled:hover:bg-sky-500 transition-all focus:outline-none shadow-sm"
                  aria-label="Gửi tin nhắn"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <div className="text-[10px] text-center text-slate-400 dark:text-slate-500 mt-2">
                Kết nối n8n AI Agent • SearXNG Search Engine
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

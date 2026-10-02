'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { 
  X, 
  MoreVertical, 
  PanelRightClose, 
  FileText, 
  Lightbulb, 
  ListTree, 
  Plus, 
  SlidersHorizontal, 
  SendHorizontal, 
  ChevronDown,
  MessageSquare,
  ExternalLink,
  Settings,
  Image as ImageIcon,
  Link as LinkIcon,
  Square
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Sparkles } from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AiConversationSplitProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  thinkStartTime?: number;
  thinkDuration?: number;
}

export function AiConversationSplit({ isOpen, onClose, initialQuery }: AiConversationSplitProps) {
  const { profile } = useAuth();
  const pathname = usePathname() || '';
  const userName = profile?.full_name?.split(' ')[0] || 'Cane';

  const pathSegment = pathname.split('/').pop() || '';
  let pageName = 'Dashboard';
  if (pathSegment && pathSegment !== 'workforce-management-dashboard') {
    pageName = pathSegment.charAt(0).toUpperCase() + pathSegment.slice(1);
  }

  const [messages, setMessages] = useState<Message[]>(
    initialQuery
      ? [
          { id: '1', role: 'user', content: initialQuery },
          { id: '2', role: 'ai', content: 'I can certainly help with that. Looking into the records now...' },
        ]
      : []
  );
  
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  
  const [width, setWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 320 && newWidth < 800) {
        setWidth(newWidth);
      }
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [isGenerating, setIsGenerating] = useState(false);

  const MarkdownComponents = {
    table: ({ node, ...props }: any) => <div className="overflow-x-auto my-4"><table className="min-w-full divide-y divide-line border border-line text-xs" {...props} /></div>,
    thead: ({ node, ...props }: any) => <thead className="bg-ink/5" {...props} />,
    th: ({ node, ...props }: any) => <th className="px-3 py-2 text-left font-medium text-ink" {...props} />,
    td: ({ node, ...props }: any) => <td className="px-3 py-2 border-t border-line" {...props} />,
    p: ({ node, ...props }: any) => <div className="mb-2 last:mb-0" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 mb-2" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 mb-2" {...props} />,
    li: ({ node, ...props }: any) => <li className="mb-1" {...props} />,
    h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-2 mt-4" {...props} />,
    h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-2 mt-3" {...props} />,
    h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2" {...props} />,
    code: ({ node, inline, ...props }: any) => inline ? <code className="bg-ink/10 px-1 py-0.5 rounded text-[11px] font-mono" {...props} /> : <div className="bg-ink/5 p-3 rounded-xl overflow-x-auto my-2 text-[11px] font-mono"><code {...props} /></div>
  };

  const distillText = (text: string) => {
    return text
      // Redact tool names
      .replace(/get_all_active_employees/g, 'employee database')
      .replace(/get_attendance/g, 'attendance records')
      .replace(/get_shifts/g, 'shift schedules')
      // Redact sensitive data
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED EMAIL]')
      .replace(/\b(?:\+?63|0)?\d{2,3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED PHONE]')
      // Basic address redaction (e.g. anything containing St, Street, Ave, Blvd, City, Province in a comma separated format)
      .replace(/\b\d+\s+[a-zA-Z0-9\s.,]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|City|Province|Region)[a-zA-Z0-9\s.,]*\b/gi, '[REDACTED ADDRESS]');
  };

  const ThoughtBlock = ({ thoughts, isGenerating, isCurrentGenerating, duration }: { thoughts: string[], isGenerating: boolean, isCurrentGenerating: boolean, duration?: number }) => {
    // Start closed by default! The user can manually open it.
    const [isOpen, setIsOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll when generating and closed
    useEffect(() => {
      if (scrollRef.current && !isOpen) {
        if (isCurrentGenerating) {
          // Scroll to bottom to show latest thoughts with a smooth ease
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        } else {
          // Snap back to top instantly when finished
          scrollRef.current.scrollTo({
            top: 0,
            behavior: 'auto'
          });
        }
      }
    }, [thoughts, isOpen, isCurrentGenerating]);

    const getMaskStyle = () => {
      if (isOpen) return {};
      if (isCurrentGenerating) {
        // While generating, fade out the top so newest text at bottom is clear
        return { 
          WebkitMaskImage: 'linear-gradient(to top, black 40%, transparent 100%)', 
          maskImage: 'linear-gradient(to top, black 40%, transparent 100%)' 
        };
      }
      // Finished: fade out the bottom to show initial thoughts
      return { 
        WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)', 
        maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)' 
      };
    };

    return (
      <div className="mb-4 flex flex-col group">
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          className="cursor-pointer select-none text-[12px] text-muted flex items-center hover:text-ink transition-colors w-fit mb-2"
        >
          <ChevronDown size={14} className={`mr-1.5 transition-transform ${isOpen ? 'rotate-180' : '-rotate-90'}`} />
          <span className="font-medium">{isCurrentGenerating ? 'Thinking...' : 'Thought process'}</span>
          {duration !== undefined && (
            <span className="ml-2 font-mono text-[10.5px] opacity-60">
              {duration.toFixed(1)}s
            </span>
          )}
        </button>
        <div 
          ref={scrollRef}
          className={`relative transition-all duration-300 ease-in-out border-l-2 border-line/60 ml-[6px] pl-3 ${isOpen ? 'max-h-[5000px]' : 'max-h-[72px] overflow-hidden'}`}
          style={getMaskStyle()}
        >
          <div className="text-[12.5px] text-muted space-y-2 opacity-90">
            {thoughts.map((t, i) => (
              <div key={i}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{distillText(t)}</ReactMarkdown>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const parseMessageContent = (msg: Message, isCurrentGenerating: boolean) => {
    const content = msg.content;
    // Find all think blocks
    const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/g;
    let match;
    const thoughts = [];
    
    while ((match = thinkRegex.exec(content)) !== null) {
      if (match[1].trim()) thoughts.push(match[1].trim());
    }
    
    const mainContent = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();

    return (
      <div className="flex flex-col w-full">
        {thoughts.length > 0 && (
          <ThoughtBlock 
            thoughts={thoughts} 
            isGenerating={isGenerating} 
            isCurrentGenerating={isCurrentGenerating && !mainContent}
            duration={msg.thinkDuration}
          />
        )}
        {mainContent ? (
          <div className="text-[13.5px] leading-relaxed break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{mainContent}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    );
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleSend = async (messageText?: string) => {
    const text = typeof messageText === 'string' ? messageText : input;
    if (!text.trim() || isGenerating) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    if (!messageText) setInput('');

    const aiMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: aiMessageId, role: 'ai', content: '' }]);
    setIsGenerating(true);
    
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/workforce-management-dashboard/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })) }),
        signal: abortControllerRef.current.signal
      });
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error("No reader");

      let done = false;
      let streamedContent = '';
      
      let thoughtStartTime: number | null = null;
      let thoughtEndTime: number | null = null;
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunkValue = decoder.decode(value, { stream: !doneReading });
          streamedContent += chunkValue;
          
          if (!thoughtStartTime && streamedContent.includes('<think>')) {
            thoughtStartTime = Date.now();
          }
          if (thoughtStartTime && !thoughtEndTime && streamedContent.includes('</think>')) {
            thoughtEndTime = Date.now();
          }
          
          let currentDuration: number | undefined = undefined;
          if (thoughtStartTime) {
            currentDuration = ((thoughtEndTime || Date.now()) - thoughtStartTime) / 1000;
          }
          
          setMessages(prev => 
            prev.map(msg => 
              msg.id === aiMessageId ? { ...msg, content: streamedContent, thinkDuration: currentDuration } : msg
            )
          );
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Stream stopped by user');
      } else {
        console.error(error);
        setMessages(prev => prev.map(msg => 
          msg.id === aiMessageId && !msg.content ? { ...msg, content: 'An error occurred while connecting to the AI system.' } : msg
        ));
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleSuggestionClick = (text: string) => {
    handleSend(text);
  };

  return (
    <div 
      style={{ width: isOpen ? `${width}px` : '0px' }}
      className={`relative flex-shrink-0 border-l border-line bg-paper flex flex-col h-full overflow-hidden transition-[transform,opacity] duration-300 ease-out shadow-xl text-ink font-sans ${
        isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'
      }`}
    >
      {/* Resizer Handle */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-accent/50 active:bg-accent z-50 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
      />
      
      {/* Header */}
      <div className="flex items-center justify-end px-3 py-3 relative min-w-[320px]">
        <div className="flex items-center gap-1">
          <div className="relative" ref={historyRef}>
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="p-1.5 rounded-full hover:bg-ink/5 dark:hover:bg-paper/10 transition-colors text-muted hover:text-ink"
            >
              <MoreVertical size={18} />
            </button>

            {/* History Dropdown Menu */}
            {showHistory && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-paper border border-line rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden pb-2">
                <div className="p-4 pb-2">
                  <span className="text-[13px] font-medium text-ink">Recent chats</span>
                </div>
                <div className="max-h-60 overflow-y-auto px-2 space-y-0.5">
                  <div className="p-2.5 text-[13px] text-muted text-center italic">No recent chats</div>
                </div>
                <div className="border-t border-line mt-1 pt-1 px-2">
                  <button className="w-full text-left flex items-center justify-between p-2.5 rounded-xl hover:bg-ink/10 transition-colors text-[13.5px] text-ink">
                    <div className="flex items-center gap-3">
                      <Settings size={16} className="text-muted shrink-0" />
                      <span>Settings & Help</span>
                    </div>
                    <ChevronDown size={14} className="text-muted" />
                  </button>
                </div>
              </div>
            )}
          </div>


          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-ink/5 dark:hover:bg-paper/10 transition-colors text-muted hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col min-w-[320px]">
        {messages.length === 0 ? (
          /* Empty State Greeting */
          <div className="flex flex-col h-full">
            <div className="mt-8 mb-6">
              <h1 className="text-3xl font-medium tracking-tight text-accent">
                Hello, {userName}
              </h1>
              <h2 className="text-3xl font-medium tracking-tight text-ink/70 dark:text-paper/70 mt-1">
                How can I help you today?
              </h2>
            </div>
            
            <div className="space-y-2 mt-4">
              <button 
                onClick={() => handleSuggestionClick('Explain driver performance rating criteria')}
                className="w-full sm:w-auto text-left flex items-center gap-3 bg-ink/5 hover:bg-ink/10 transition-colors border border-transparent rounded-2xl px-4 py-3 text-sm text-ink font-medium"
              >
                <FileText size={16} className="text-accent" />
                Explain driver performance rating criteria
              </button>
              
              <button 
                onClick={() => handleSuggestionClick('Help me come up with new ideas')}
                className="w-full sm:w-auto text-left flex items-center gap-3 bg-ink/5 hover:bg-ink/10 transition-colors border border-transparent rounded-2xl px-4 py-3 text-sm text-ink font-medium"
              >
                <Lightbulb size={16} className="text-accent" />
                Help me come up with new ideas
              </button>
              
              <button 
                onClick={() => handleSuggestionClick('Get more perspectives on a topic')}
                className="w-full sm:w-auto text-left flex items-center gap-3 bg-ink/5 hover:bg-ink/10 transition-colors border border-transparent rounded-2xl px-4 py-3 text-sm text-ink font-medium"
              >
                <ListTree size={16} className="text-accent" />
                Get more perspectives on a topic
              </button>
            </div>
          </div>
        ) : (
          /* Messages List */
          <div className="space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-4 py-2.5 rounded-3xl bg-ink/10 text-ink text-sm leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[95%] text-ink text-sm leading-relaxed w-full">
                    <div className="flex items-center gap-3 mb-2">
                      <Sparkles size={16} className={`text-accent ${isGenerating && messages[messages.length - 1].id === msg.id ? 'animate-pulse' : ''}`} />
                    </div>
                    {parseMessageContent(msg, isGenerating && messages[messages.length - 1].id === msg.id)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="px-4 pb-5 pt-2 relative min-w-[320px]">
        
        {showAttachments && (
          <div className="absolute bottom-[calc(100%-0.5rem)] left-4 flex gap-2 p-2 bg-paper rounded-2xl border border-line shadow-lg z-50">
            <button className="flex flex-col items-center justify-center w-16 h-16 rounded-xl hover:bg-ink/10 transition-colors text-muted hover:text-ink">
              <FileText size={20} className="mb-1" />
              <span className="text-[10px] font-medium">Upload file</span>
            </button>
            <button className="flex flex-col items-center justify-center w-16 h-16 rounded-xl hover:bg-ink/10 transition-colors text-muted hover:text-ink">
              <ImageIcon size={20} className="mb-1" />
              <span className="text-[10px] font-medium">Attach image</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between bg-ink/5 rounded-xl px-4 py-2.5 mb-2 mx-auto max-w-full">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            Looking at {pageName}
          </div>
        </div>

        <div className="bg-ink/5 rounded-[24px] p-2 flex flex-col focus-within:bg-ink/10 transition-colors border border-transparent focus-within:border-accent/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask me anything..."
            className="w-full bg-transparent border-none px-3 pt-3 pb-2 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-0 resize-none max-h-32 min-h-[44px]"
            rows={1}
          />
          
          <div className="flex items-center justify-between px-1 pb-1">
            <div className="flex items-center gap-1 text-muted">
              <button 
                onClick={() => setShowAttachments(!showAttachments)}
                className="p-2 rounded-full hover:bg-ink/10 transition-colors hover:text-ink"
              >
                <Plus size={20} />
              </button>
            </div>
            
            <div className="flex items-center gap-1">
              {isGenerating ? (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    stopGenerating();
                  }}
                  className="p-2 rounded-full transition-colors flex items-center justify-center bg-red-500 text-white hover:bg-red-600"
                >
                  <Square size={20} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className={`p-2 rounded-full transition-colors flex items-center justify-center ${
                    input.trim() ? 'bg-ink text-paper' : 'bg-transparent text-muted'
                  }`}
                >
                  <SendHorizontal size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

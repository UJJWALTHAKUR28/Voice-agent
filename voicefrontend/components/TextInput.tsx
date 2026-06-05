// components/TextInput.tsx
//
// Text input bar at the bottom of the chat.
// On submit: sends the text to the agent via DataPacket AND adds it to
// the transcript immediately (optimistic update).

'use client';

import { useState, useRef, KeyboardEvent } from 'react';

interface TextInputProps {
    onSend: (text: string) => void;  // called with the typed message
    disabled?: boolean;
}

export function TextInput({ onSend, disabled }: TextInputProps) {
    const [value, setValue] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const submit = () => {
        const text = value.trim();
        if (!text || disabled) return;
        onSend(text);
        setValue('');
        // Reset textarea height
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter submits; Shift+Enter adds a newline
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    // Auto-grow textarea up to 5 rows
    const onInput = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '10px',
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)',
        }}>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={onKeyDown}
                onInput={onInput}
                placeholder="Type a message…"
                disabled={disabled}
                rows={1}
                style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    resize: 'none',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    minHeight: '42px',
                    maxHeight: '120px',
                    overflowY: 'auto',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />

            {/* Send button */}
            <button
                onClick={submit}
                disabled={!value.trim() || disabled}
                title="Send (Enter)"
                style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: 'var(--radius-md)',
                    background: !value.trim() || disabled
                        ? 'var(--bg-glass)'
                        : 'var(--accent)',
                    border: '1px solid var(--border)',
                    color: !value.trim() || disabled
                        ? 'var(--text-muted)'
                        : '#fff',
                    cursor: !value.trim() || disabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.2s, color 0.2s',
                    fontSize: '18px',
                }}
            >
                ↑
            </button>
        </div>
    );
}
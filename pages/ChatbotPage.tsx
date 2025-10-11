import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Chat } from '@google/genai';
import { createChatSession, sendMessage } from '../services/geminiService';
import { Message, MessageAuthor, ContentType, Project, Snapshot, BlastHit, ContentBlock, Pipeline, AiResponse, ToolCall, RecentChat } from '../types';
import { GREETINGS } from '../constants';
import { useAppContext } from '../App';

import ChatWindow from '../components/ChatWindow';
import ChatInput from '../components/ChatInput';
import PDBViewer from '../components/PDBViewer';
import MarkdownRenderer from '../components/MarkdownRenderer';
import BlastViewer from '../components/BlastChart';
import BlastProgress from '../components/BlastProgress';
import { PinIcon, ShareIcon, CheckIcon } from '../components/icons';

declare const window: any; // For SpeechRecognition

const Caption: React.FC<{ text: string }> = ({ text }) => (
    <p className="text-xs text-center font-semibold text-[var(--muted-foreground-color)] mb-2 uppercase tracking-wider">{text}</p>
);

const ChatbotPage: React.FC = () => {
  const { 
      projects, setProjects, pipelines, setApiStatus, 
      activeProjectId, activeProjectName, recentChats, setRecentChats,
      isNewChat, setIsNewChat
  } = useAppContext();
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Input & Voice State
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // New Feature States
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  // Modals State
  const [isProjectModalOpen, setProjectModalOpen] = useState(false);
  const [isPipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [contentToSave, setContentToSave] = useState<ContentBlock | null>(null);
  const [showCopiedTooltip, setShowCopiedTooltip] = useState(false);
  
  const pollIntervalsRef = useRef<Record<string, { intervalId: number; timeoutId: number }>>({});
  
  const historyKey = useMemo(() => activeProjectId ? `chatHistory_${activeProjectId}` : 'chatHistory_general', [activeProjectId]);
  
  const handleSaveToActiveProject = useCallback((contentBlock: ContentBlock) => {
    if (!activeProjectId) return;
    setProjects(prevProjects => 
        prevProjects.map(p => {
            if (p.id === activeProjectId) {
                const newBlock: ContentBlock = { id: `cb-${Date.now()}`, type: contentBlock.type, data: contentBlock.data };
                return { ...p, contentBlocks: [...p.contentBlocks, newBlock], lastModified: new Date().toISOString() };
            }
            return p;
        })
    );
    const systemMessage: Message = { id: `sys-${Date.now()}`, author: MessageAuthor.SYSTEM, content: `Content saved to project: "${activeProjectName}"`, rawContent: `Content saved to project: "${activeProjectName}"` };
    setMessages(prev => [...prev, systemMessage]);
  }, [activeProjectId, activeProjectName, setProjects]);
  
  const handleSaveContent = useCallback((contentBlock: ContentBlock) => {
    if (activeProjectId) {
        handleSaveToActiveProject(contentBlock);
    } else {
        setContentToSave(contentBlock);
        setProjectModalOpen(true);
    }
  }, [activeProjectId, handleSaveToActiveProject]);

  const handleShareContent = useCallback((contentBlock: ContentBlock) => {
    const id = `snap-${Date.now()}`;
    const snapshot: Snapshot = {
        id,
        createdAt: new Date().toISOString(),
        contentBlock: { ...contentBlock, id: `cb-${id}`},
    };

    localStorage.setItem(`snapshot_${id}`, JSON.stringify(snapshot));
    const url = `${window.location.origin}${window.location.pathname}#snapshot/${id}`;
    navigator.clipboard.writeText(url);
    setShowCopiedTooltip(true);
    setTimeout(() => setShowCopiedTooltip(false), 2000);
  }, []);
  
  const renderRhesusContent = useCallback((rawContentString?: string): React.ReactNode => {
    if (!rawContentString) return null;

    try {
        // Attempt to parse as our structured AiResponse object
        const response: AiResponse = JSON.parse(rawContentString);
        const componentParts: React.ReactNode[] = [];

        if (response.prose) {
            componentParts.push(<MarkdownRenderer key="prose" content={response.prose} />);
        }

        if (response.tool_calls) {
            response.tool_calls.forEach((tool_call, index) => {
                const { type, data } = tool_call;
                const contentBlock: ContentBlock = { id: `tool-${Date.now()}-${index}`, type, data };
                let contentWithCaption: React.ReactNode = null;

                switch (type) {
                    case ContentType.PDB_VIEWER:
                        contentWithCaption = (<div><Caption text={`3D Structure: ${data.pdbId}`} /><PDBViewer pdbId={data.pdbId} /></div>);
                        break;
                    case ContentType.PUBMED_SUMMARY:
                        contentWithCaption = (<div className="p-4 bg-[var(--input-background-color)] rounded-lg border border-[var(--border-color)]"><Caption text="Literature Summary" /><h3 className="font-bold mb-2 primary-text">Summary</h3><MarkdownRenderer content={data.summary} /></div>);
                        break;
                    case ContentType.BLAST_RESULT:
                        contentWithCaption = (<div className="p-4 bg-[var(--input-background-color)] rounded-lg border border-[var(--border-color)]"><Caption text="BLAST Results" />{Array.isArray(data) ? <BlastViewer data={data} /> : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(data, null, 2)}</pre>}</div>);
                        break;
                    case ContentType.BLAST_PROGRESS:
                        contentWithCaption = (<BlastProgress status={data.status} jobId={data.jobId} errorMessage={data.errorMessage} />);
                        break;
                }

                if (contentWithCaption) {
                    componentParts.push(
                        <div key={contentBlock.id} className="relative group my-2 first:mt-0 last:mb-0">
                            {contentWithCaption}
                             { type !== ContentType.BLAST_PROGRESS && (
                                <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <button onClick={() => handleSaveContent(contentBlock)} className="p-1.5 bg-slate-700/80 text-white rounded-full hover:bg-slate-600"><PinIcon /></button>
                                    <button onClick={() => handleShareContent(contentBlock)} className="p-1.5 bg-slate-700/80 text-white rounded-full hover:bg-slate-600"><ShareIcon /></button>
                                </div>
                            )}
                        </div>
                    );
                }
            });
        }
        return <div>{componentParts}</div>;

    } catch (e) {
        // If parsing fails, it's likely just a plain string (like the initial greeting)
        return <MarkdownRenderer content={rawContentString} />;
    }
  }, [handleSaveContent, handleShareContent]);


  const rehydrateMessages = useCallback((storedMessages: any[]) => {
      return storedMessages.map(msg => {
            let content: React.ReactNode;
            if (msg.author === MessageAuthor.RHESUS) {
                // For BLAST_PROGRESS messages that were interrupted, show an error state on reload.
                if (msg.rawContent?.includes(ContentType.BLAST_PROGRESS)) {
                    content = <BlastProgress status="error" errorMessage="Search was interrupted. Please try again." />;
                } else {
                    content = renderRhesusContent(msg.rawContent);
                }
            } else {
                content = <MarkdownRenderer content={msg.rawContent || ''} />;
            }
            return { ...msg, content };
      });
  }, [renderRhesusContent]);
  
  const handleToggleAudio = useCallback((messageId: string, text: string) => {
    if (speakingMessageId === messageId) {
        window.speechSynthesis.cancel();
        setSpeakingMessageId(null);
    } else {
        try {
            window.speechSynthesis.cancel();
            const utteranceText = JSON.parse(text).prose || text;
            const utterance = new SpeechSynthesisUtterance(utteranceText);
            utterance.onend = () => setSpeakingMessageId(null);
            setSpeakingMessageId(messageId);
            window.speechSynthesis.speak(utterance);
        } catch(e) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onend = () => setSpeakingMessageId(null);
            setSpeakingMessageId(messageId);
            window.speechSynthesis.speak(utterance);
        }
    }
  }, [speakingMessageId]);
  
  const processSlashCommand = (command: string): string => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
        case '/visualize': return `Show me the 3D structure for PDB ID ${arg}`;
        case '/blast': return `Run a BLAST search for the following: ${arg}`;
        case '/search': return `Search the web for: ${arg}`;
        default: return command;
    }
  };

  const isLoadingRef = useRef(isLoading);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

    const stopPolling = useCallback((jobId: string) => {
        if (pollIntervalsRef.current[jobId]) {
            clearInterval(pollIntervalsRef.current[jobId].intervalId);
            clearTimeout(pollIntervalsRef.current[jobId].timeoutId);
            delete pollIntervalsRef.current[jobId];
        }
    }, []);

    const startPolling = useCallback((jobId: string, messageId: string) => {
        const intervalId = window.setInterval(async () => {
            try {
                const pollResponse = await fetch('/api/blastp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId })
                });

                if (!pollResponse.ok) throw new Error(`Polling failed with status: ${pollResponse.status}`);
                const pollData = await pollResponse.json();
                
                if (pollData.status === 'FINISHED') {
                    stopPolling(jobId);
                    const finalRawContent = JSON.stringify({
                        prose: "The real-time BLASTp search is complete. Here are the top results.",
                        tool_calls: [{ type: ContentType.BLAST_RESULT, data: pollData.results }]
                    });
                    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, rawContent: finalRawContent, content: renderRhesusContent(finalRawContent) } : m));

                } else if (pollData.status === 'FAILURE') {
                    stopPolling(jobId);
                    const errorRawContent = JSON.stringify({
                        tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'error', jobId, errorMessage: pollData.message } }]
                    });
                    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, rawContent: errorRawContent, content: renderRhesusContent(errorRawContent) } : m));
                }
            } catch (error: any) {
                stopPolling(jobId);
                 const errorRawContent = JSON.stringify({
                    tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'error', jobId, errorMessage: error.message } }]
                });
                setMessages(prev => prev.map(m => m.id === messageId ? { ...m, rawContent: errorRawContent, content: renderRhesusContent(errorRawContent) } : m));
            }
        }, 5000);

        const timeoutId = window.setTimeout(() => {
            if (pollIntervalsRef.current[jobId]) {
                stopPolling(jobId);
                const timeoutRawContent = JSON.stringify({
                    tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'error', jobId, errorMessage: 'Polling timed out after 5 minutes.' } }]
                });
                setMessages(prev => prev.map(m => m.id === messageId ? { ...m, rawContent: timeoutRawContent, content: renderRhesusContent(timeoutRawContent) } : m));
            }
        }, 300000);

        pollIntervalsRef.current[jobId] = { intervalId, timeoutId };
    }, [stopPolling, renderRhesusContent]);
    
    const handleFetchBlastJob = useCallback(async (jobId: string) => {
        if (!jobId) return;

        const systemMessage: Message = {
            id: `sys-${Date.now()}`,
            author: MessageAuthor.SYSTEM,
            content: `Attempting to fetch results for job ID: ${jobId}`,
            rawContent: `Attempting to fetch results for job ID: ${jobId}`
        };
        setMessages(prev => [...prev, systemMessage]);

        const progressMessageId = `blast-${Date.now()}`;
        const pollingProgressRawContent = JSON.stringify({
            tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'polling', jobId } }]
        });
        const progressMessage: Message = {
            id: progressMessageId,
            author: MessageAuthor.RHESUS,
            content: renderRhesusContent(pollingProgressRawContent),
            rawContent: pollingProgressRawContent
        };
        setMessages(prev => [...prev, progressMessage]);
        
        startPolling(jobId, progressMessageId);

    }, [renderRhesusContent, startPolling]);


  const handleSendMessage = useCallback(async (messageContent: string, file?: File, replyToMessage?: Message | null): Promise<void> => {
      const trimmedMessage = messageContent.trim();
      if (trimmedMessage.startsWith('/fetchblast ')) {
          const jobId = trimmedMessage.split(' ')[1];
          if (jobId) {
              const newUserMessage: Message = {
                  id: Date.now().toString(),
                  author: MessageAuthor.USER,
                  content: <MarkdownRenderer content={trimmedMessage} />,
                  rawContent: trimmedMessage,
              };
              setMessages(prev => [...prev, newUserMessage]);
              setInput('');
              setReplyingTo(null);
              await handleFetchBlastJob(jobId);
              return;
          }
      }

      if (!chat || isLoadingRef.current) return;
      let finalPrompt = messageContent;
      if (file) finalPrompt = `Analyze this uploaded PDB file: ${await file.text()}`;
      if (finalPrompt.startsWith('/')) finalPrompt = processSlashCommand(finalPrompt);
      if (replyToMessage) finalPrompt = `In reply to "${replyToMessage.rawContent}", ${finalPrompt}`;
      if (!finalPrompt.trim()) return;
      
      const isStartingANewConversation = isNewChat;
      setIsNewChat(false);

      const displayedMessage = messageContent || `Uploaded ${file?.name}`;
      const newUserMessage: Message = { 
          id: Date.now().toString(), 
          author: MessageAuthor.USER, 
          content: <MarkdownRenderer content={displayedMessage} />, 
          rawContent: displayedMessage,
          replyTo: replyToMessage ? { id: replyToMessage.id, author: replyToMessage.author === MessageAuthor.USER ? "you" : "Dr. Rhesus", content: replyToMessage.rawContent || ''} : undefined
      };
      
      setMessages(prev => [...prev, newUserMessage]);
      setIsLoading(true);
      setInput('');
      setReplyingTo(null);
      
      if (isStartingANewConversation) {
          const chatId = activeProjectId || 'general';
          let title = finalPrompt.substring(0, 40) + (finalPrompt.length > 40 ? '...' : '');
          const newChat: RecentChat = activeProjectId
              ? { id: activeProjectId, title, type: 'project', projectName: activeProjectName }
              : { id: 'general', title, type: 'general' };
          setRecentChats(prev => [newChat, ...prev.filter(c => c.id !== newChat.id)]);
      }

      try {
          const fullResponse = await sendMessage(chat, finalPrompt);
          let responseData: AiResponse;
          try {
              // The API is supposed to return a JSON object. Sometimes it might fail and return plain text.
              // We'll try to find a JSON object within the response.
              const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
              if (!jsonMatch) throw new Error("No JSON object found in response");
              responseData = JSON.parse(jsonMatch[0]);
          } catch (e) {
              console.warn("Could not parse AI response as JSON, treating as plain prose.", fullResponse);
              responseData = { prose: fullResponse, tool_calls: [], actions: [] };
          }
          
          const blastToolCall = responseData.tool_calls?.find(tc => tc.type === 'run_blastp');

          // Add AI's prose part first, but without the blast tool call
          const proseRawContent = JSON.stringify({ prose: responseData.prose, actions: responseData.actions });
          const rhesusMessage: Message = {
              id: `rhesus-${Date.now()}`,
              author: MessageAuthor.RHESUS,
              content: renderRhesusContent(proseRawContent),
              rawContent: proseRawContent,
              actions: responseData.actions || []
          };
          setMessages(prev => [...prev, rhesusMessage]);

          if (blastToolCall && blastToolCall.data.sequence) {
              // Now, handle the BLAST part in a separate, evolving message
              const progressMessageId = `blast-${Date.now()}`;
              const initialProgressRawContent = JSON.stringify({ tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'submitting' } }] });
              const progressMessage: Message = {
                  id: progressMessageId,
                  author: MessageAuthor.RHESUS,
                  content: renderRhesusContent(initialProgressRawContent),
                  rawContent: initialProgressRawContent
              };
              setMessages(prev => [...prev, progressMessage]);

              try {
                  const submitApiResponse = await fetch('/api/blastp', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sequence: blastToolCall.data.sequence })
                  });

                  if (!submitApiResponse.ok) {
                      const errorBody = await submitApiResponse.json();
                      throw new Error(errorBody.error || `BLAST service failed: ${submitApiResponse.statusText}`);
                  }

                  const { jobId } = await submitApiResponse.json();
                  if (!jobId) throw new Error("Did not receive a Job ID from the server.");
                  
                  const pollingProgressRawContent = JSON.stringify({ tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'polling', jobId } }] });
                  setMessages(prev => prev.map(m => m.id === progressMessageId ? { ...m, rawContent: pollingProgressRawContent, content: renderRhesusContent(pollingProgressRawContent) } : m));
                  startPolling(jobId, progressMessageId);

              } catch (blastError: any) {
                  const errorRawContent = JSON.stringify({ tool_calls: [{ type: ContentType.BLAST_PROGRESS, data: { status: 'error', errorMessage: blastError.message } }] });
                  setMessages(prev => prev.map(m => m.id === progressMessageId ? { ...m, rawContent: errorRawContent, content: renderRhesusContent(errorRawContent) } : m));
              }
          }
          setApiStatus('healthy');
      } catch (error) {
          setApiStatus('error');
          const errorMsg: Message = { id: `error-${Date.now()}`, author: MessageAuthor.SYSTEM, content: "Sorry, an error occurred communicating with the AI.", rawContent: "Sorry, an error occurred communicating with the AI." };
          setMessages(prev => [...prev, errorMsg]);
      } finally {
          setIsLoading(false);
      }
  }, [chat, setApiStatus, renderRhesusContent, activeProjectId, activeProjectName, recentChats, setRecentChats, isNewChat, setIsNewChat, startPolling, handleFetchBlastJob]);

  const handleSendMessageRef = useRef(handleSendMessage);
  useEffect(() => { handleSendMessageRef.current = handleSendMessage; }, [handleSendMessage]);

  const replyingToRef = useRef(replyingTo);
  useEffect(() => { replyingToRef.current = replyingTo; }, [replyingTo]);
  
  useEffect(() => {
    setChat(createChatSession());
    const stored = localStorage.getItem(historyKey);
    let initialMessages = [];
    if (isNewChat || !stored) {
        const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        initialMessages = [{ id: 'initial', author: MessageAuthor.RHESUS, content: <MarkdownRenderer content={greeting}/>, rawContent: greeting }];
    } else {
        try {
            const storedMessages = JSON.parse(stored);
            if (Array.isArray(storedMessages) && storedMessages.length > 0) {
                initialMessages = rehydrateMessages(storedMessages);
            }
        } catch (e) {
            localStorage.removeItem(historyKey);
        }
    }
    if(initialMessages.length === 0) {
        const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        initialMessages = [{ id: 'initial', author: MessageAuthor.RHESUS, content: <MarkdownRenderer content={greeting}/>, rawContent: greeting }];
    }
    setMessages(initialMessages);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        setIsSpeechSupported(true);
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.onstart = () => setIsRecording(true);
        recognitionRef.current.onend = () => setIsRecording(false);
        recognitionRef.current.onerror = (event: any) => { console.error('Speech recognition error:', event.error); setIsRecording(false); };
        recognitionRef.current.onresult = (event: any) => {
            const transcript = Array.from(event.results).map((result: any) => result[0].transcript).join('');
            setInput(transcript);
            if (event.results[0].isFinal) {
              handleSendMessageRef.current(transcript.trim(), undefined, replyingToRef.current);
              setInput('');
            }
        };
    }
    return () => { Object.keys(pollIntervalsRef.current).forEach(jobId => stopPolling(jobId)); };
  }, [historyKey, rehydrateMessages, isNewChat, stopPolling]);

  useEffect(() => {
    const initialQuery = sessionStorage.getItem('initialQuery');
    if (initialQuery && chat) {
        sessionStorage.removeItem('initialQuery');
        handleSendMessage(initialQuery);
    }
  }, [chat, handleSendMessage]);

  useEffect(() => {
    if (isNewChat) return;
    const serializableMessages = messages.map(({ id, author, rawContent, actions, replyTo }) => ({ id, author, rawContent, actions, replyTo }));
    localStorage.setItem(historyKey, JSON.stringify(serializableMessages));
  }, [messages, historyKey, isNewChat]);
  
  const handleToggleRecording = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
        recognitionRef.current.stop();
    } else {
        setInput('');
        recognitionRef.current.start();
    }
  };
  
  const handleReply = useCallback((message: Message) => { setReplyingTo(message); }, []);
  const handleCancelReply = useCallback(() => { setReplyingTo(null); }, []);

  const handleSaveToProject = (projectId: string) => {
    if (!contentToSave) return;
    setProjects(prevProjects => 
        prevProjects.map(p => {
            if (p.id === projectId) {
                const newBlock: ContentBlock = { id: `cb-${Date.now()}`, type: contentToSave.type, data: contentToSave.data };
                return { ...p, contentBlocks: [...p.contentBlocks, newBlock], lastModified: new Date().toISOString() };
            }
            return p;
        })
    );
    setProjectModalOpen(false);
    setContentToSave(null);
    const savedProject = projects.find(p => p.id === projectId);
    if (savedProject) {
        const systemMessage: Message = { id: `sys-${Date.now()}`, author: MessageAuthor.SYSTEM, content: `Content saved to project: "${savedProject.title}"`, rawContent: `Content saved to project: "${savedProject.title}"` };
        setMessages(prev => [...prev, systemMessage]);
    }
  };

  const handleRunPipeline = async (pipeline: Pipeline, target: string) => {
    if (!target) { alert("Please provide a target for the pipeline (e.g., a protein name or PDB ID)."); return; }
    setPipelineModalOpen(false);
    const systemMessage: Message = { id: `sys-${Date.now()}`, author: MessageAuthor.SYSTEM, content: `Running pipeline "${pipeline.name}" with target "${target}"...`, rawContent: `Running pipeline "${pipeline.name}" with target "${target}"...` };
    setMessages(prev => [...prev, systemMessage]);
    for (const step of pipeline.steps) {
        const prompt = step.prompt.replace(/\{protein_name\}/g, target);
        await handleSendMessage(prompt);
    }
    const completionMessage: Message = { id: `sys-${Date.now()}-done`, author: MessageAuthor.SYSTEM, content: `Pipeline "${pipeline.name}" finished.`, rawContent: `Pipeline "${pipeline.name}" finished.` };
    setMessages(prev => [...prev, completionMessage]);
  };
  
  return (
    <div className="relative overflow-hidden flex flex-col h-full bg-[var(--background-color)]">
      <ChatWindow 
        messages={messages} 
        isLoading={isLoading} 
        onPromptClick={(prompt) => handleSendMessage(prompt)}
        onToggleAudio={handleToggleAudio}
        onReply={handleReply}
        speakingMessageId={speakingMessageId}
      />
      <ChatInput 
        onSendMessage={handleSendMessage} 
        isLoading={isLoading} 
        onRunPipeline={() => setPipelineModalOpen(true)}
        input={input}
        setInput={setInput}
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        isSpeechSupported={isSpeechSupported}
        replyingTo={replyingTo}
        onCancelReply={handleCancelReply}
      />
      
      {isProjectModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={() => setProjectModalOpen(false)}>
              <div className="bg-[var(--popover-background-color)] p-6 rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
                  <h3 className="font-bold text-lg mb-4 text-[var(--popover-foreground-color)]">Save to Project</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                      {projects.length > 0 ? projects.map(p => <button key={p.id} onClick={() => handleSaveToProject(p.id)} className="w-full text-left p-3 bg-[var(--input-background-color)] hover:bg-[var(--border-color)] rounded-md text-[var(--popover-foreground-color)]">{p.title}</button>) : <p className="text-sm text-[var(--muted-foreground-color)]">No projects yet.</p>}
                  </div>
              </div>
          </div>
      )}
      {isPipelineModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={() => setPipelineModalOpen(false)}>
              <PipelineRunnerModal pipelines={pipelines} onRun={handleRunPipeline} onClose={() => setPipelineModalOpen(false)} />
          </div>
      )}
      {showCopiedTooltip && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm z-50 flex items-center gap-2"><CheckIcon /> Copied sharing link to clipboard!</div>}
    </div>
  );
};

const PipelineRunnerModal: React.FC<{pipelines: any[], onRun: (p: any, t: string) => void, onClose: () => void}> = ({ pipelines, onRun, onClose }) => {
    const [selectedPipeline, setSelectedPipeline] = useState<any | null>(null);
    const [target, setTarget] = useState('');
    if (!selectedPipeline) {
        return (
            <div className="bg-[var(--popover-background-color)] p-6 rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-lg mb-4 text-[var(--popover-foreground-color)]">Run a Pipeline</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {pipelines.length > 0 ? pipelines.map(p => <button key={p.id} onClick={() => setSelectedPipeline(p)} className="w-full text-left p-3 bg-[var(--input-background-color)] hover:bg-[var(--border-color)] rounded-md text-[var(--popover-foreground-color)]">{p.name}</button>) : <p className="text-[var(--muted-foreground-color)] text-sm">No pipelines created yet. Go to Settings to create one.</p>}
                </div>
            </div>
        )
    }
    return (
        <div className="bg-[var(--popover-background-color)] p-6 rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1 text-[var(--popover-foreground-color)]">Run: {selectedPipeline.name}</h3>
            <p className="text-sm text-[var(--muted-foreground-color)] mb-4">{selectedPipeline.description}</p>
            <input type="text" value={target} onChange={e => setTarget(e.target.value)} placeholder="Enter target (e.g., PDB ID, protein name)" className="w-full bg-[var(--input-background-color)] p-3 rounded-md border border-[var(--border-color)] focus:primary-ring focus:outline-none mb-4" />
            <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-md text-sm">Cancel</button>
                <button onClick={() => onRun(selectedPipeline, target)} className="px-4 py-2 primary-bg text-white rounded-md text-sm">Run</button>
            </div>
        </div>
    )
};

export default ChatbotPage;

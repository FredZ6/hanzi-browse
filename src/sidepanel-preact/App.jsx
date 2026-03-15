import { useState } from 'preact/hooks';
import { useConfig } from './hooks/useConfig';
import { useChat } from './hooks/useChat';
import { Header } from './components/Header';
import { MessageList } from './components/MessageList';
import { InputArea } from './components/InputArea';
import { SettingsModal } from './components/SettingsModal';
import { PlanModal } from './components/PlanModal';
import { EmptyState } from './components/EmptyState';

export function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [suggestedText, setSuggestedText] = useState('');
  const config = useConfig();
  const chat = useChat();

  if (config.isLoading) {
    return (
      <div class="loading-container">
        <div class="loading-spinner" />
      </div>
    );
  }

  // If onboarding not completed, show a prompt to complete setup
  if (!config.onboarding.completed) {
    return (
      <div class="app">
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <h2>Welcome to Hanzi</h2>
          <p>Complete setup to get started.</p>
          <button
            class="btn btn-primary"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dist/onboarding.html') })}
          >
            Open Setup
          </button>
        </div>
      </div>
    );
  }

  const hasMessages = chat.messages.length > 0;

  return (
    <div class="app">
      <Header
        currentModel={config.currentModel}
        availableModels={config.availableModels}
        currentModelIndex={config.currentModelIndex}
        onModelSelect={config.selectModel}
        onNewChat={chat.clearChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <div class="messages-container">
        {!hasMessages ? (
          <EmptyState onSelectExample={setSuggestedText} primaryMode={config.onboarding.primaryMode} />
        ) : (
          <MessageList
            messages={chat.messages}
            pendingStep={chat.pendingStep}
          />
        )}
      </div>

      <InputArea
        isRunning={chat.isRunning}
        attachedImages={chat.attachedImages}
        onSend={chat.sendMessage}
        onStop={chat.stopTask}
        onAddImage={chat.addImage}
        onRemoveImage={chat.removeImage}
        hasModels={config.availableModels.length > 0}
        suggestedText={suggestedText}
        onClearSuggestion={() => setSuggestedText('')}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {isSettingsOpen && (
        <SettingsModal
          config={config}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {chat.pendingPlan && (
        <PlanModal
          plan={chat.pendingPlan}
          onApprove={chat.approvePlan}
          onCancel={chat.cancelPlan}
        />
      )}
    </div>
  );
}

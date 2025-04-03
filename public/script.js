document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const chatWindow = document.getElementById('chat-window');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const statusLights = {
        human: document.getElementById('light-human'),
        gemini: document.getElementById('light-gemini'),
        llama: document.getElementById('light-llama'),
        qwen: document.getElementById('light-qwen')
    };

    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to server');
        statusLights.human.classList.add('active');
        messageInput.disabled = false;
    });

    socket.on('newMessage', (message) => {
        addMessageToChat(message);
    });

    socket.on('typingStatus', (typingAgents) => {
        updateTypingIndicator(typingAgents);
    });

    // Helper functions
    function createMessageElement(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', message.senderType);
        
        // Add sender name except for system messages
        if (message.senderType !== 'system') {
            const senderEl = document.createElement('div');
            senderEl.classList.add('sender');
            senderEl.textContent = message.sender;
            messageEl.appendChild(senderEl);
        }
        
        const contentEl = document.createElement('div');
        contentEl.classList.add('content');
        contentEl.textContent = message.content;
        messageEl.appendChild(contentEl);
        
        return messageEl;
    }

    function updateTypingIndicator(typingAgents) {
        const typingArea = document.getElementById('typing-indicator-area');
        typingArea.innerHTML = '';
        
        if (typingAgents.length > 0) {
            const typingText = document.createElement('div');
            typingText.textContent = `${typingAgents.join(', ')} ${typingAgents.length === 1 ? 'is' : 'are'} typing...`;
            typingArea.appendChild(typingText);
        }
    }

    function addMessageToChat(message) {
        const messageEl = createMessageElement(message);
        chatWindow.appendChild(messageEl);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        
        // Update status lights
        if (statusLights[message.senderType]) {
            Object.values(statusLights).forEach(light => light.classList.remove('active'));
            statusLights[message.senderType].classList.add('active');
        }
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (content) {
            socket.emit('humanMessage', content);
            messageInput.value = '';
        }
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});

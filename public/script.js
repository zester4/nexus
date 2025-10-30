document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const chatWindow = document.getElementById('chat-window');
    const chatWrapper = document.getElementById('chat-window-wrapper');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const commandsBtn = document.getElementById('commands-btn');
    const commandPanel = document.getElementById('command-panel');
    const closeCommandsBtn = document.getElementById('close-commands');
    const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
    
    const statusLights = {
        human: document.getElementById('light-human'),
        gemini: document.getElementById('light-gemini'),
        llama: document.getElementById('light-llama'),
        qwen: document.getElementById('light-qwen'),
        gpt: document.getElementById('light-gpt')
    };

    // Command definitions for autocomplete
    const commands = [
        { cmd: '/help', desc: 'Show all available commands' },
        { cmd: '/roles', desc: 'View agent specializations' },
        { cmd: '/roundtable ', desc: 'All agents respond sequentially to a topic' },
        { cmd: '/consensus ', desc: 'Quick poll from all agents' },
        { cmd: '/focus @', desc: 'Consult specific agent (e.g., /focus @Gemini)' },
        { cmd: '/role ', desc: 'Change agent role (e.g., /role Gemini = "...")' }
    ];

    let autocompleteIndex = -1;
    let filteredCommands = [];

    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to server');
        statusLights.human.classList.add('active');
        messageInput.disabled = false;
        addSystemNotification('Connected to Nexus Chat');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        Object.values(statusLights).forEach(light => light.classList.remove('active'));
        messageInput.disabled = true;
        addSystemNotification('Disconnected from server');
    });

    socket.on('newMessage', (message) => {
        addMessageToChat(message);
    });

    socket.on('initialHistory', (history) => {
        console.log('Received initial history:', history.length, 'messages');
        history.forEach(message => {
            addMessageToChat(message, false); // false = don't auto-scroll for history
        });
        // Scroll to bottom after loading history
        setTimeout(() => {
            chatWrapper.scrollTop = chatWrapper.scrollHeight;
        }, 100);
    });

    socket.on('typingStatus', (typingAgents) => {
        updateTypingIndicator(typingAgents);
    });

    // Command panel toggle
    commandsBtn.addEventListener('click', () => {
        commandPanel.classList.toggle('hidden');
    });

    closeCommandsBtn.addEventListener('click', () => {
        commandPanel.classList.add('hidden');
    });

    // Command item click handlers
    document.querySelectorAll('.command-item').forEach(item => {
        item.addEventListener('click', () => {
            const command = item.dataset.command;
            messageInput.value = command;
            messageInput.focus();
            commandPanel.classList.add('hidden');
            
            // Show autocomplete if command needs input
            if (command.endsWith(' ') || command.endsWith('@')) {
                showAutocomplete(command);
            }
        });
    });

    // Agent quick select buttons
    document.querySelectorAll('.agent-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const agent = btn.dataset.agent;
            messageInput.value = `/focus @${agent} `;
            messageInput.focus();
            commandPanel.classList.add('hidden');
        });
    });

    // Input event handlers
    messageInput.addEventListener('input', (e) => {
        const value = e.target.value;
        
        // Check if in command mode
        if (value.startsWith('/')) {
            messageInput.classList.add('command-mode');
            handleAutocomplete(value);
        } else {
            messageInput.classList.remove('command-mode');
            hideAutocomplete();
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        // Handle autocomplete navigation
        if (autocompleteDropdown.classList.contains('hidden') === false) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateAutocomplete(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateAutocomplete(-1);
            } else if (e.key === 'Tab' || e.key === 'Enter') {
                if (autocompleteIndex >= 0 && filteredCommands.length > 0) {
                    e.preventDefault();
                    selectAutocomplete(filteredCommands[autocompleteIndex]);
                    return;
                }
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        }
        
        // Send message on Enter
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendButton.addEventListener('click', sendMessage);

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
        
        // Parse content for special formatting
        contentEl.innerHTML = parseMessageContent(message.content);
        
        messageEl.appendChild(contentEl);
        
        return messageEl;
    }

    function parseMessageContent(content) {
        // Convert URLs to links
        let parsed = content.replace(
            /(https?:\/\/[^\s]+)/g, 
            '<a href="$1" target="_blank" style="color: var(--accent-primary); text-decoration: underline;">$1</a>'
        );
        
        // Highlight agent mentions
        parsed = parsed.replace(
            /@(Gemini|Llama|Qwen|GPT)/g,
            '<span style="color: var(--accent-primary); font-weight: 600;">@$1</span>'
        );
        
        // Highlight tool usage
        parsed = parsed.replace(
            /\[Used (browser_search|code_interpreter)\]/g,
            '<span style="color: var(--text-system); font-size: 0.85em;">[$1]</span>'
        );
        
        return parsed;
    }

    function updateTypingIndicator(typingAgents) {
        const typingArea = document.getElementById('typing-indicator-area');
        typingArea.innerHTML = '';
        
        if (typingAgents.length > 0) {
            const typingText = document.createElement('span');
            typingText.textContent = `${typingAgents.join(', ')} ${typingAgents.length === 1 ? 'is' : 'are'} typing`;
            
            const dots = document.createElement('span');
            dots.className = 'typing-dots';
            dots.innerHTML = '<span></span><span></span><span></span>';
            
            typingArea.appendChild(typingText);
            typingArea.appendChild(dots);
        }
    }

    function addMessageToChat(message, autoScroll = true) {
        const messageEl = createMessageElement(message);
        chatWindow.appendChild(messageEl);
        
        if (autoScroll) {
            chatWrapper.scrollTop = chatWrapper.scrollHeight;
        }
        
        // Update status lights
        if (statusLights[message.senderType]) {
            // Briefly highlight the active speaker
            Object.values(statusLights).forEach(light => light.classList.remove('active'));
            statusLights[message.senderType].classList.add('active');
            
            // Keep human light always active when connected
            if (socket.connected) {
                statusLights.human.classList.add('active');
            }
        }
    }

    function addSystemNotification(text) {
        const notification = {
            sender: 'System',
            content: text,
            senderType: 'system',
            timestamp: Date.now()
        };
        addMessageToChat(notification);
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (content) {
            socket.emit('humanMessage', content);
            messageInput.value = '';
            messageInput.classList.remove('command-mode');
            hideAutocomplete();
        }
    }

    // Autocomplete functions
    function handleAutocomplete(input) {
        if (!input.startsWith('/')) {
            hideAutocomplete();
            return;
        }

        const parts = input.split(' ');
        const firstWord = parts[0].toLowerCase();

        // Filter commands that match
        filteredCommands = commands.filter(c => 
            c.cmd.toLowerCase().startsWith(firstWord)
        );

        if (filteredCommands.length > 0) {
            showAutocomplete(input);
        } else {
            hideAutocomplete();
        }
    }

    function showAutocomplete(input) {
        if (filteredCommands.length === 0) return;

        autocompleteDropdown.innerHTML = '';
        autocompleteIndex = -1;

        filteredCommands.forEach((cmd, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.dataset.index = index;
            
            const cmdEl = document.createElement('div');
            cmdEl.className = 'autocomplete-command';
            cmdEl.textContent = cmd.cmd;
            
            const descEl = document.createElement('div');
            descEl.className = 'autocomplete-desc';
            descEl.textContent = cmd.desc;
            
            item.appendChild(cmdEl);
            item.appendChild(descEl);
            
            item.addEventListener('click', () => {
                selectAutocomplete(cmd);
            });
            
            autocompleteDropdown.appendChild(item);
        });

        autocompleteDropdown.classList.remove('hidden');
    }

    function hideAutocomplete() {
        autocompleteDropdown.classList.add('hidden');
        autocompleteIndex = -1;
    }

    function navigateAutocomplete(direction) {
        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return;

        // Remove previous selection
        if (autocompleteIndex >= 0) {
            items[autocompleteIndex].classList.remove('selected');
        }

        // Update index
        autocompleteIndex += direction;
        if (autocompleteIndex < 0) autocompleteIndex = items.length - 1;
        if (autocompleteIndex >= items.length) autocompleteIndex = 0;

        // Add new selection
        items[autocompleteIndex].classList.add('selected');
        items[autocompleteIndex].scrollIntoView({ block: 'nearest' });
    }

    function selectAutocomplete(command) {
        messageInput.value = command.cmd;
        messageInput.focus();
        hideAutocomplete();
    }

    // Close command panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!commandPanel.contains(e.target) && !commandsBtn.contains(e.target)) {
            commandPanel.classList.add('hidden');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K to open commands
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            commandPanel.classList.toggle('hidden');
        }
        
        // Escape to close command panel
        if (e.key === 'Escape' && !commandPanel.classList.contains('hidden')) {
            commandPanel.classList.add('hidden');
        }
    });

    console.log('Nexus Chat client initialized');
    console.log('Keyboard shortcuts:');
    console.log('  - Ctrl/Cmd + K: Toggle command panel');
    console.log('  - / : Start typing command with autocomplete');
    console.log('  - Tab/Enter: Select autocomplete suggestion');
});

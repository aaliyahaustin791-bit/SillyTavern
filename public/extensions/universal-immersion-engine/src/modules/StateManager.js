const EXT_ID = "universal-immersion-engine";

// Helper to safely get the ST context across versions
function getSafeContext() {
    return typeof window.SillyTavern?.getContext === 'function' 
        ? window.SillyTavern.getContext() 
        : (typeof window.getContext === 'function' ? window.getContext() : null);
}

export function getChatData() {
    const context = getSafeContext();
    if (!context || !context.chatId) {
        return { inventory: [], phone: {}, databank: {} };
    }
    
    // Handle ST naming differences
    const metadata = context.chatMetadata || context.chat_metadata || window.chat_metadata;
    if (!metadata) {
        return { inventory: [], phone: {}, databank: {} };
    }

    if (!metadata[EXT_ID]) {
        metadata[EXT_ID] = {
            inventory: [],
            phone: { messages: [], activeContacts: [] },
            databank: {}
        };
    }
    return metadata[EXT_ID];
}

export function saveChatData(data) {
    const context = getSafeContext();
    if (!context || !context.chatId) return;

    const metadata = context.chatMetadata || context.chat_metadata || window.chat_metadata;
    if (metadata) {
        metadata[EXT_ID] = data;
    }

    // CRITICAL FIX: Tell SillyTavern to write this to disk!
    if (typeof window.saveChatDebounced === 'function') {
        window.saveChatDebounced();
    } else if (typeof window.saveMetadataDebounced === 'function') {
        window.saveMetadataDebounced();
    } else {
        console.warn("[UIE] Could not find ST save function to persist data!");
    }
}

export function migrateLegacyData() {
    const context = getSafeContext();
    const globalSettings = window.extension_settings?.[EXT_ID] || {};
    const hasOldData = globalSettings.inventory || globalSettings.phone || globalSettings.databank;
    
    if (!hasOldData || !context || !context.chatId) return false;
    
    const metadata = context.chatMetadata || context.chat_metadata || window.chat_metadata;
    if (!metadata) return false;
    
    console.log("[UIE] Migrating legacy data to chat...");
    metadata[EXT_ID] = {
        inventory: globalSettings.inventory || [],
        phone: globalSettings.phone || { messages: [], activeContacts: [] },
        databank: globalSettings.databank || {}
    };
    
    delete globalSettings.inventory;
    delete globalSettings.phone;
    delete globalSettings.databank;
    
    if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
    if (typeof window.saveChatDebounced === 'function') window.saveChatDebounced();
    
    return true;
}

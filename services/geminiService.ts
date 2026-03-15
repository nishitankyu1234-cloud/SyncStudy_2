import { GoogleGenAI, Type } from "@google/genai";
import { TestQuestion, UserProfile } from "../types";

// Vercelの設定に合わせて3つのキーを読み込む
const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1,
  import.meta.env.VITE_GEMINI_API_KEY_2,
  import.meta.env.VITE_GEMINI_API_KEY_3
].filter(Boolean);

// 10秒制限を突破するために最速の「8b」モデルを使用
const MODEL_TEXT = 'gemini-1.5-flash-8b';

// 3つのキーを順番に試す共通関数
async function getAIResponse(callback: (ai: any) => Promise<any>) {
  let lastError;
  for (const key of API_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      return await callback(ai);
    } catch (error) {
      lastError = error;
      console.warn("APIキー制限のため、次のキーを試行します。");
      continue;
    }
  }
  throw lastError || new Error("すべてのAPIキーで失敗しました。");
}

export const createChatStream = async function* (
  history: any[],
  newMessage: string,
  imageDataUrl?: string,
  userProfile?: UserProfile
) {
  const systemInstruction = `
あなたは日本トップクラスの予備校講師です。
【指導方針】
1. 最高品質の解説 2. 誤字脱字排除 3. ソクラテス式誘導 4. 共通テスト・難関大対応
温かみのある「です・ます」調で指導してください。
${userProfile?.targetUniversity ? `目標：${userProfile.targetUniversity}` : ''}
`;

  const result = await getAIResponse(async (ai) => {
    const chat = ai.chats.create({
      model: MODEL_TEXT,
      history: history,
      config: { systemInstruction }
    });

    let messageContent: any = newMessage;
    if (imageDataUrl) {
      const [header, base64Data] = imageDataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      messageContent = [
        { text: newMessage || "この画像について解説してください。" },
        { inlineData: { mimeType, data: base64Data } }
      ];
    }
    return await chat.sendMessageStream({ message: messageContent });
  });

  for await (const chunk of result) {
    yield chunk.text;
  }
};

export const generateTestQuestions = async (topic: string, userProfile?: UserProfile, count: number = 3): Promise<TestQuestion[]> => {
  // 夜間の混雑時でも10秒以内に返すためのプロンプト調整
  const prompt = `「${topic}」の4択問題を${count}問、JSONで作成。
  【重要】Vercelのタイムアウトを避けるため、解説は1問につき3行以内で簡潔かつ論理的に記述してください。`;

  const response = await getAIResponse(async (ai) => {
    return await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswerIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING }
            },
            required: ["question", "options", "correctAnswerIndex", "explanation"]
          }
        }
      }
    });
  });

  if (response.text) {
    return JSON.parse(response.text.trim()) as TestQuestion[];
  }
  throw new Error("Failed");
};
  throw lastError || new Error("Failed to generate test data after multiple attempts");
};

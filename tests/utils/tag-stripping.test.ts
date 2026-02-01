/**
 * Tag Stripping Utility Tests
 *
 * Tests the privacy system for <private>, <claude-mem-context>, and <secret> tags,
 * plus automatic secret redaction patterns.
 * These tags enable users and the system to exclude/redact content from memory storage.
 *
 * Sources:
 * - Implementation from src/utils/tag-stripping.ts
 * - Privacy patterns from src/services/worker/http/routes/SessionRoutes.ts
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { stripMemoryTagsFromPrompt, stripMemoryTagsFromJson, redactSecrets } from '../../src/utils/tag-stripping.js';
import { logger } from '../../src/utils/logger.js';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

describe('Tag Stripping Utilities', () => {
  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
  });

  describe('stripMemoryTagsFromPrompt', () => {
    describe('basic tag removal', () => {
      it('should strip single <private> tag and preserve surrounding content', () => {
        const input = 'public content <private>secret stuff</private> more public';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('public content  more public');
      });

      it('should strip single <claude-mem-context> tag', () => {
        const input = 'public content <claude-mem-context>injected context</claude-mem-context> more public';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('public content  more public');
      });

      it('should strip both tag types in mixed content', () => {
        const input = '<private>secret</private> public <claude-mem-context>context</claude-mem-context> end';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('public  end');
      });
    });

    describe('multiple tags handling', () => {
      it('should strip multiple <private> blocks', () => {
        const input = '<private>first secret</private> middle <private>second secret</private> end';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('middle  end');
      });

      it('should strip multiple <claude-mem-context> blocks', () => {
        const input = '<claude-mem-context>ctx1</claude-mem-context><claude-mem-context>ctx2</claude-mem-context> content';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('content');
      });

      it('should handle many interleaved tags', () => {
        let input = 'start';
        for (let i = 0; i < 10; i++) {
          input += ` <private>p${i}</private> <claude-mem-context>c${i}</claude-mem-context>`;
        }
        input += ' end';
        const result = stripMemoryTagsFromPrompt(input);
        // Tags are stripped but spaces between them remain
        expect(result).not.toContain('<private>');
        expect(result).not.toContain('<claude-mem-context>');
        expect(result).toContain('start');
        expect(result).toContain('end');
      });
    });

    describe('empty and private-only prompts', () => {
      it('should return empty string for entirely private prompt', () => {
        const input = '<private>entire prompt is private</private>';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('');
      });

      it('should return empty string for entirely context-tagged prompt', () => {
        const input = '<claude-mem-context>all is context</claude-mem-context>';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('');
      });

      it('should preserve content with no tags', () => {
        const input = 'no tags here at all';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('no tags here at all');
      });

      it('should handle empty input', () => {
        const result = stripMemoryTagsFromPrompt('');
        expect(result).toBe('');
      });

      it('should handle whitespace-only after stripping', () => {
        const input = '<private>content</private>   <claude-mem-context>more</claude-mem-context>';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('');
      });
    });

    describe('content preservation', () => {
      it('should preserve non-tagged content exactly', () => {
        const input = 'keep this <private>remove this</private> and this';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('keep this  and this');
      });

      it('should preserve special characters in non-tagged content', () => {
        const input = 'code: const x = 1; <private>secret</private> more: { "key": "value" }';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('code: const x = 1;  more: { "key": "value" }');
      });

      it('should preserve newlines in non-tagged content', () => {
        const input = 'line1\n<private>secret</private>\nline2';
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('line1\n\nline2');
      });
    });

    describe('multiline content in tags', () => {
      it('should strip multiline content within <private> tags', () => {
        const input = `public
<private>
multi
line
secret
</private>
end`;
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('public\n\nend');
      });

      it('should strip multiline content within <claude-mem-context> tags', () => {
        const input = `start
<claude-mem-context>
# Recent Activity
- Item 1
- Item 2
</claude-mem-context>
finish`;
        const result = stripMemoryTagsFromPrompt(input);
        expect(result).toBe('start\n\nfinish');
      });
    });

    describe('ReDoS protection', () => {
      it('should handle content with many tags without hanging (< 1 second)', async () => {
        // Generate content with many tags
        let content = '';
        for (let i = 0; i < 150; i++) {
          content += `<private>secret${i}</private> text${i} `;
        }

        const startTime = Date.now();
        const result = stripMemoryTagsFromPrompt(content);
        const duration = Date.now() - startTime;

        // Should complete quickly despite many tags
        expect(duration).toBeLessThan(1000);
        // Should not contain any private content
        expect(result).not.toContain('<private>');
        // Should warn about exceeding tag limit
        expect(loggerSpies[2]).toHaveBeenCalled(); // warn spy
      });

      it('should process within reasonable time with nested-looking patterns', () => {
        // Content that looks like it could cause backtracking
        const content = '<private>' + 'x'.repeat(10000) + '</private> keep this';

        const startTime = Date.now();
        const result = stripMemoryTagsFromPrompt(content);
        const duration = Date.now() - startTime;

        expect(duration).toBeLessThan(1000);
        expect(result).toBe('keep this');
      });
    });
  });

  describe('stripMemoryTagsFromJson', () => {
    describe('JSON content stripping', () => {
      it('should strip tags from stringified JSON', () => {
        const jsonContent = JSON.stringify({
          file_path: '/path/to/file',
          content: '<private>secret</private> public'
        });
        const result = stripMemoryTagsFromJson(jsonContent);
        const parsed = JSON.parse(result);
        expect(parsed.content).toBe(' public');
      });

      it('should strip claude-mem-context tags from JSON', () => {
        const jsonContent = JSON.stringify({
          data: '<claude-mem-context>injected</claude-mem-context> real data'
        });
        const result = stripMemoryTagsFromJson(jsonContent);
        const parsed = JSON.parse(result);
        expect(parsed.data).toBe(' real data');
      });

      it('should handle tool_input with tags', () => {
        const toolInput = {
          command: 'echo hello',
          args: '<private>secret args</private>'
        };
        const result = stripMemoryTagsFromJson(JSON.stringify(toolInput));
        const parsed = JSON.parse(result);
        expect(parsed.args).toBe('');
      });

      it('should handle tool_response with tags', () => {
        const toolResponse = {
          output: 'result <claude-mem-context>context data</claude-mem-context>',
          status: 'success'
        };
        const result = stripMemoryTagsFromJson(JSON.stringify(toolResponse));
        const parsed = JSON.parse(result);
        expect(parsed.output).toBe('result ');
      });
    });

    describe('edge cases', () => {
      it('should handle empty JSON object', () => {
        const result = stripMemoryTagsFromJson('{}');
        expect(result).toBe('{}');
      });

      it('should handle JSON with no tags', () => {
        const input = JSON.stringify({ key: 'value' });
        const result = stripMemoryTagsFromJson(input);
        expect(result).toBe(input);
      });

      it('should handle nested JSON structures', () => {
        const input = JSON.stringify({
          outer: {
            inner: '<private>secret</private> visible'
          }
        });
        const result = stripMemoryTagsFromJson(input);
        const parsed = JSON.parse(result);
        expect(parsed.outer.inner).toBe(' visible');
      });
    });
  });

  describe('privacy enforcement integration', () => {
    it('should allow empty result to trigger privacy skip', () => {
      // Simulates what SessionRoutes does with private-only prompts
      const prompt = '<private>entirely private prompt</private>';
      const cleanedPrompt = stripMemoryTagsFromPrompt(prompt);

      // Empty/whitespace prompts should trigger skip
      const shouldSkip = !cleanedPrompt || cleanedPrompt.trim() === '';
      expect(shouldSkip).toBe(true);
    });

    it('should allow partial content when not entirely private', () => {
      const prompt = '<private>password123</private> Please help me with my code';
      const cleanedPrompt = stripMemoryTagsFromPrompt(prompt);

      const shouldSkip = !cleanedPrompt || cleanedPrompt.trim() === '';
      expect(shouldSkip).toBe(false);
      expect(cleanedPrompt.trim()).toBe('Please help me with my code');
    });
  });

  describe('secret tag handling', () => {
    it('should replace <secret> tag content with [REDACTED]', () => {
      const input = 'My API key is <secret>sk-123abc456def</secret> for testing';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('My API key is [REDACTED] for testing');
    });

    it('should handle multiple <secret> tags', () => {
      const input = 'Key: <secret>abc</secret> and Password: <secret>def</secret>';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('Key: [REDACTED] and Password: [REDACTED]');
    });

    it('should handle multiline content in <secret> tags', () => {
      const input = `Config:
<secret>
api_key: sk-123
secret: mysecret
</secret>
End config`;
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('Config:\n[REDACTED]\nEnd config');
    });

    it('should handle mixed <private> and <secret> tags', () => {
      const input = '<private>removed</private> public <secret>redacted</secret> more';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('public [REDACTED] more');
    });

    it('should handle empty <secret> tags', () => {
      const input = 'text <secret></secret> more';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('text [REDACTED] more');
    });
  });

  describe('redactSecrets function', () => {
    describe('OpenAI API keys', () => {
      it('should redact OpenAI-style API keys', () => {
        const input = 'My API key is sk-1234567890abcdefghij1234567890';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('My API key is [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact multiple API keys', () => {
        const input = 'Keys: sk-abc123def456ghi789jkl012 and sk-xyz999uvw888rst777';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Keys: [REDACTED] and [REDACTED]');
        expect(count).toBe(2);
      });
    });

    describe('Generic API keys', () => {
      it('should redact api_ prefixed keys', () => {
        const input = 'Token: api_1234567890abcdefghij1234567890';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Token: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact key_ prefixed keys', () => {
        const input = 'Access: key_abcdefghijklmnopqrstuvwxyz123456';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Access: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('Bearer tokens', () => {
      it('should redact Bearer tokens (case insensitive)', () => {
        const input = 'Authorization: Bearer abc123def456.xyz789';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Authorization: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact lowercase bearer tokens', () => {
        const input = 'Auth: bearer tokenvalue123456';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Auth: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('AWS credentials', () => {
      it('should redact AWS Access Key IDs', () => {
        const input = 'AWS Key: AKIAIOSFODNN7EXAMPLE';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('AWS Key: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('Private keys', () => {
      it('should redact RSA private keys', () => {
        const input = `Key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----
End`;
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toContain('[REDACTED]');
        expect(redacted).not.toContain('BEGIN RSA PRIVATE KEY');
        expect(count).toBe(1);
      });

      it('should redact generic private keys', () => {
        const input = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC
-----END PRIVATE KEY-----`;
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('[REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('Password patterns', () => {
      it('should redact password= pattern', () => {
        const input = 'Config: password=mysecretpass123';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Config: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact passwd: pattern', () => {
        const input = 'Auth: passwd: secretvalue';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Auth: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact pwd= with quotes', () => {
        const input = 'Login: pwd="mypassword123"';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Login: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('JWT tokens', () => {
      it('should redact JWT tokens', () => {
        const input = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Token: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('GitHub tokens', () => {
      it('should redact GitHub personal access tokens', () => {
        const input = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Token: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact GitHub OAuth tokens', () => {
        const input = 'OAuth: gho_1234567890abcdefghijklmnopqrstuvwxyz';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('OAuth: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('Generic secrets', () => {
      it('should redact token= pattern', () => {
        const input = 'Auth: token=abc123def456ghi789jkl012mno345';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Auth: [REDACTED]');
        expect(count).toBe(1);
      });

      it('should redact secret: pattern', () => {
        const input = 'Config: secret: "mysecretvalue12345678901234567890"';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe('Config: [REDACTED]');
        expect(count).toBe(1);
      });
    });

    describe('edge cases', () => {
      it('should return original content if no secrets found', () => {
        const input = 'This is just normal text with no secrets';
        const { redacted, count } = redactSecrets(input);
        expect(redacted).toBe(input);
        expect(count).toBe(0);
      });

      it('should handle empty string', () => {
        const { redacted, count } = redactSecrets('');
        expect(redacted).toBe('');
        expect(count).toBe(0);
      });

      it('should handle null/undefined gracefully', () => {
        const { redacted: r1, count: c1 } = redactSecrets(null as any);
        expect(r1).toBe('');
        expect(c1).toBe(0);

        const { redacted: r2, count: c2 } = redactSecrets(undefined as any);
        expect(r2).toBe('');
        expect(c2).toBe(0);
      });

      it('should not log original content (security)', () => {
        const input = 'Secret: sk-1234567890abcdefghij1234567890';
        redactSecrets(input);

        // Verify logger was called but never with the original secret
        const allCalls = loggerSpies.flatMap(spy =>
          spy.mock.calls.map(call => JSON.stringify(call))
        );
        const hasSecret = allCalls.some(call => call.includes('sk-1234567890abcdefghij1234567890'));
        expect(hasSecret).toBe(false);
      });
    });

    describe('performance', () => {
      it('should process large content quickly', () => {
        // Generate large content with some secrets mixed in
        let content = '';
        for (let i = 0; i < 1000; i++) {
          content += `Line ${i}: some normal text here\n`;
          if (i % 100 === 0) {
            content += `Secret line: sk-abc123def456ghi789jkl012mno345pqr678\n`;
          }
        }

        const startTime = Date.now();
        const { redacted, count } = redactSecrets(content);
        const duration = Date.now() - startTime;

        expect(duration).toBeLessThan(1000); // Should complete in < 1 second
        expect(count).toBeGreaterThan(0);
        expect(redacted).toContain('[REDACTED]');
      });
    });
  });

  describe('automatic redaction integration', () => {
    it('should automatically redact secrets in stripMemoryTagsFromPrompt', () => {
      const input = 'Please use this API key: sk-1234567890abcdefghij1234567890 for testing';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('Please use this API key: [REDACTED] for testing');
    });

    it('should apply both tag stripping and automatic redaction', () => {
      const input = '<private>private stuff</private> public text with sk-abc123def456ghi789jkl012mno345';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('public text with [REDACTED]');
      expect(result).not.toContain('private');
      expect(result).not.toContain('sk-abc');
    });

    it('should redact secrets inside <secret> tags and pattern-matched secrets', () => {
      const input = 'Manual: <secret>mysecret</secret> and automatic: password=test123';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('Manual: [REDACTED] and automatic: [REDACTED]');
    });

    it('should not double-redact already redacted content', () => {
      const input = 'Already redacted: [REDACTED]';
      const result = stripMemoryTagsFromPrompt(input);
      expect(result).toBe('Already redacted: [REDACTED]');
      // Should still be just one [REDACTED], not nested
      expect(result.match(/\[REDACTED\]/g)?.length).toBe(1);
    });
  });
});

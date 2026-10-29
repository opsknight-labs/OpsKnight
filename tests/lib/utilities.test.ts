import { describe, it, expect } from 'vitest';

describe('Utility Functions', () => {
    describe('Encryption', () => {
        it('should encrypt sensitive data', () => {
            const encrypt = (data: string, _key: string) => {
                // Mock encryption
                return Buffer.from(data).toString('base64');
            };

            const encrypted = encrypt('sensitive-data', 'secret-key');
            expect(encrypted).toBeDefined();
            expect(encrypted).not.toBe('sensitive-data');
        });

        it('should decrypt encrypted data', () => {
            const decrypt = (encrypted: string, _key: string) => {
                // Mock decryption
                return Buffer.from(encrypted, 'base64').toString('utf-8');
            };

            const encrypted = Buffer.from('sensitive-data').toString('base64');
            const decrypted = decrypt(encrypted, 'secret-key');

            expect(decrypted).toBe('sensitive-data');
        });
    });

    describe('Date Formatting', () => {
        it('should format date to ISO string', () => {
            const date = new Date('2024-01-01T12:00:00Z');
            const formatted = date.toISOString();

            expect(formatted).toBe('2024-01-01T12:00:00.000Z');
        });

        it('should format date to readable string', () => {
            const formatDate = (date: Date) => {
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                });
            };

            const date = new Date('2024-01-15');
            const formatted = formatDate(date);

            expect(formatted).toContain('2024');
            expect(formatted).toContain('January');
        });

        it('should calculate time difference', () => {
            const getTimeDiff = (start: Date, end: Date) => {
                return end.getTime() - start.getTime();
            };

            const start = new Date('2024-01-01T00:00:00Z');
            const end = new Date('2024-01-01T01:00:00Z');
            const diff = getTimeDiff(start, end);

            expect(diff).toBe(3600000); // 1 hour in milliseconds
        });
    });

    describe('String Utilities', () => {
        it('should truncate long strings', () => {
            const truncate = (str: string, maxLength: number) => {
                if (str.length <= maxLength) return str;
                return str.substring(0, maxLength) + '...';
            };

            expect(truncate('Short', 10)).toBe('Short');
            expect(truncate('This is a very long string', 10)).toBe('This is a ...');
        });

        it('should capitalize first letter', () => {
            const capitalize = (str: string) => {
                return str.charAt(0).toUpperCase() + str.slice(1);
            };

            expect(capitalize('hello')).toBe('Hello');
            expect(capitalize('world')).toBe('World');
        });

        it('should convert to slug', () => {
            const slugify = (str: string) => {
                return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
            };

            expect(slugify('Hello World')).toBe('hello-world');
            expect(slugify('Test String!')).toBe('test-string');
        });
    });

    describe('Array Utilities', () => {
        it('should remove duplicates', () => {
            const removeDuplicates = <T,>(arr: T[]) => {
                return [...new Set(arr)];
            };

            expect(removeDuplicates([1, 2, 2, 3, 3, 4])).toEqual([1, 2, 3, 4]);
            expect(removeDuplicates(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
        });

        it('should chunk array', () => {
            const chunk = <T,>(arr: T[], size: number) => {
                const chunks: T[][] = [];
                for (let i = 0; i < arr.length; i += size) {
                    chunks.push(arr.slice(i, i + size));
                }
                return chunks;
            };

            expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
            expect(chunk(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
        });

        it('should group by property', () => {
            const groupBy = <T,>(arr: T[], key: keyof T) => {
                return arr.reduce((groups, item) => {
                    const value = String(item[key]);
                    if (!groups[value]) groups[value] = [];
                    groups[value].push(item);
                    return groups;
                }, {} as Record<string, T[]>);
            };

            const items = [
                { type: 'A', value: 1 },
                { type: 'B', value: 2 },
                { type: 'A', value: 3 },
            ];

            const grouped = groupBy(items, 'type');

            expect(grouped['A']).toHaveLength(2);
            expect(grouped['B']).toHaveLength(1);
        });
    });

    describe('Object Utilities', () => {
        it('should deep clone object', () => {
            const deepClone = <T,>(obj: T): T => {
                return JSON.parse(JSON.stringify(obj));
            };

            const original = { a: 1, b: { c: 2 } };
            const cloned = deepClone(original);

            cloned.b.c = 3;

            expect(original.b.c).toBe(2);
            expect(cloned.b.c).toBe(3);
        });

        it('should merge objects', () => {
            const merge = <T extends object>(target: T, source: Partial<T>): T => {
                return { ...target, ...source };
            };

            const obj1 = { a: 1, b: 2 };
            const obj2 = { b: 3, c: 4 };
            const merged = merge(obj1, obj2 as Partial<typeof obj1>);

            expect(merged).toEqual({ a: 1, b: 3, c: 4 });
        });

        it('should pick properties', () => {
            const pick = <T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
                const result = {} as Pick<T, K>;
                keys.forEach(key => {
                    result[key] = obj[key];
                });
                return result;
            };

            const obj = { a: 1, b: 2, c: 3 };
            const picked = pick(obj, ['a', 'c']);

            expect(picked).toEqual({ a: 1, c: 3 });
        });
    });
});

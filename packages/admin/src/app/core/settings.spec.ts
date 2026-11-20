import { completeProjectDir, projectDirHint, settingsReady } from './settings';

describe('opzioni', () => {
  it("l'esempio di cartella parte dalla cartella dei progetti", () => {
    expect(projectDirHint('D:\\dev')).toBe('D:\\dev\\…');
    expect(projectDirHint('D:\\dev\\')).toBe('D:\\dev\\…');
    expect(projectDirHint('/home/me/dev/')).toBe('/home/me/dev/…');
    expect(projectDirHint(undefined)).toBe('C:\\progetti\\…');
  });

  it('Tab completa la cartella dei progetti solo se il campo ne è l’inizio', () => {
    expect(completeProjectDir('', 'D:\\dev')).toBe('D:\\dev\\');
    expect(completeProjectDir('d:\\d', 'D:\\dev')).toBe('D:\\dev\\');
    expect(completeProjectDir('D:\\dev\\', 'D:\\dev')).toBeNull();
    expect(completeProjectDir('D:\\dev\\app', 'D:\\dev')).toBeNull();
    expect(completeProjectDir('E:\\', 'D:\\dev')).toBeNull();
    expect(completeProjectDir('', undefined)).toBeNull();
  });

  it('servono le opzioni di base', () => {
    expect(settingsReady(null)).toBe(false);
    expect(settingsReady({ projectsDir: '  ' })).toBe(false);
    expect(settingsReady({ projectsDir: 'D:\\dev' })).toBe(true);
  });
});

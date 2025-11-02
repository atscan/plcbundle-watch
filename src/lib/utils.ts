import numeral from 'numeral';

export function formatNumber(n: number) {
    return numeral(n).format()
}

export function formatUptime(totalSeconds: number): string {
      if (totalSeconds < 0) {
          return "Invalid input: seconds cannot be negative";
      }
      if (totalSeconds === 0) {
          return "0s";
      }

      let parts: string[] = [];
      let displayUnits: [string, number][];

      const SECONDS_IN_MINUTE = 60;
      const SECONDS_IN_HOUR = 3600; // 60 minutes * 60 seconds/minute
      const SECONDS_IN_DAY = 24 * SECONDS_IN_HOUR;

      if (totalSeconds > SECONDS_IN_DAY) { // If uptime is bigger than 1 day
          displayUnits = [
              ['d', SECONDS_IN_DAY],
              ['h', SECONDS_IN_HOUR],
          ];
      } else if (totalSeconds > SECONDS_IN_MINUTE) { // If uptime is bigger than 60 seconds but not bigger than 60 minutes
          displayUnits = [
              ['d', SECONDS_IN_DAY],
              ['h', SECONDS_IN_HOUR],
              ['m', SECONDS_IN_MINUTE],
          ];
      } else { // If uptime is 60 seconds or less
          displayUnits = [
              ['d', SECONDS_IN_DAY],
              ['h', SECONDS_IN_HOUR],
              ['m', SECONDS_IN_MINUTE],
              ['s', 1],
          ];
      }

      let remainingSeconds = totalSeconds;

      for (const [unitChar, unitSeconds] of displayUnits) {
          if (remainingSeconds >= unitSeconds) {
              const value = Math.floor(remainingSeconds / unitSeconds);
              parts.push(`${value}${unitChar}`);
              remainingSeconds %= unitSeconds;
          }
      }

      return parts.join("");
  }
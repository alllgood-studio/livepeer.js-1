import { VideoPlayerProps as VideoPlayerCoreProps } from '@livepeer/core-react/components';
import { HlsSrc, MediaControllerState, VideoSrc } from 'livepeer';
import {
  addMediaMetricsToInitializedStore,
  canPlayMediaNatively,
} from 'livepeer/media/browser';
import {
  HlsError,
  HlsVideoConfig,
  createNewHls,
  isHlsSupported,
} from 'livepeer/media/browser/hls';
import { styling } from 'livepeer/media/browser/styling';
import * as React from 'react';

import { isAccessControlError, isStreamOfflineError } from './utils';
import { MediaControllerContext, useMediaController } from '../../../context';
import { PosterSource } from '../Player';

const mediaControllerSelector = ({
  fullscreen,
}: MediaControllerState<HTMLMediaElement>) => ({
  fullscreen,
});

export type VideoPlayerProps = VideoPlayerCoreProps<
  HTMLVideoElement,
  PosterSource
> & {
  hlsConfig?: HlsVideoConfig;
  allowCrossOriginCredentials?: boolean;
};

export const VideoPlayer = React.forwardRef<HTMLVideoElement, VideoPlayerProps>(
  (props, ref) => {
    const { fullscreen } = useMediaController(mediaControllerSelector);

    const {
      hlsConfig,
      src,
      autoPlay,
      title,
      loop,
      muted,
      poster,
      objectFit,
      onStreamStatusChange,
      onMetricsError,
      onAccessControlError,
      priority,
      allowCrossOriginCredentials,
    } = props;

    const canUseHlsjs = React.useMemo(() => isHlsSupported(), []);

    const [filteredSources, setFilteredSources] = React.useState<
      VideoSrc[] | HlsSrc[] | null
    >(null);

    React.useEffect(() => {
      // if the first source is HLS, then we attempt playback from it
      // otherwise, we filter by regular video sources
      setFilteredSources(
        src?.[0]?.type === 'hls'
          ? [src[0]]
          : src
              ?.filter((s) => s?.type === 'video' && canPlayMediaNatively(s))
              .map((s) => s as VideoSrc) ?? null,
      );
    }, [src]);

    const store = React.useContext(MediaControllerContext);

    React.useEffect(() => {
      const { destroy } = addMediaMetricsToInitializedStore(
        store,
        filteredSources?.[0]?.src,
        (e) => {
          onMetricsError?.(e as Error);
          console.error('Not able to report player metrics', e);
        },
      );

      return destroy;
    }, [onMetricsError, store, filteredSources]);

    // use HLS.js if Media Source is supported, fallback to using a regular video player
    const shouldUseHlsjs = React.useMemo(
      () => canUseHlsjs && filteredSources?.[0]?.type === 'hls',
      [canUseHlsjs, filteredSources],
    );

    React.useEffect(() => {
      const element = store.getState()._element;

      if (element && shouldUseHlsjs) {
        const onLive = (fullscreen: boolean) => {
          onStreamStatusChange?.(true);
          store.getState().setLive(fullscreen);
        };

        const onError = (error: HlsError) => {
          const cleanError = new Error(
            error?.response?.data?.toString?.() ?? 'Error with HLS.js',
          );
          if (isStreamOfflineError(cleanError)) {
            onStreamStatusChange?.(false);
          } else if (isAccessControlError(cleanError)) {
            onAccessControlError?.(cleanError);
          }
          console.warn(cleanError.message);
        };

        const { destroy } = createNewHls(
          filteredSources?.[0]?.src as HlsSrc['src'],
          element,
          {
            onLive,
            onDuration: store.getState().onDurationChange,
            onCanPlay: store.getState().onCanPlay,
            onError,
          },
          {
            autoplay: autoPlay,
            xhrSetup(xhr, _url) {
              xhr.withCredentials = Boolean(allowCrossOriginCredentials);
            },
            ...hlsConfig,
          },
        );

        return () => {
          destroy();
        };
      }
    }, [
      autoPlay,
      hlsConfig,
      filteredSources,
      store,
      shouldUseHlsjs,
      onStreamStatusChange,
      onAccessControlError,
      allowCrossOriginCredentials,
    ]);

    // use HLS.js if Media Source is supported, then fallback to using a regular HTML video player
    return shouldUseHlsjs ? (
      <video
        className={styling.media.video({
          size: fullscreen ? 'fullscreen' : objectFit,
        })}
        loop={loop}
        aria-label={title ?? 'Video player'}
        role="video"
        width="100%"
        height="100%"
        ref={ref}
        webkit-playsinline="true"
        playsInline
        autoPlay={autoPlay}
        muted={muted}
        poster={typeof poster === 'string' ? poster : undefined}
        preload={priority ? 'auto' : 'metadata'}
        crossOrigin={
          allowCrossOriginCredentials ? 'use-credentials' : 'anonymous'
        }
      />
    ) : (
      <HtmlVideoPlayer
        {...props}
        ref={ref}
        filteredSources={filteredSources}
        fullscreen={fullscreen}
      />
    );
  },
);

type HtmlVideoPlayerProps = Omit<VideoPlayerProps, 'src'> & {
  filteredSources: VideoSrc[] | HlsSrc[] | null;
  fullscreen: boolean;
};

const HtmlVideoPlayer = React.forwardRef<
  HTMLVideoElement,
  HtmlVideoPlayerProps
>((props, ref) => {
  const {
    autoPlay,
    title,
    loop,
    muted,
    poster,
    objectFit,
    onAccessControlError,
    filteredSources,
    fullscreen,
  } = props;

  const handleError = React.useCallback(
    (error: Error) => {
      if (isAccessControlError(error)) {
        onAccessControlError?.(error);
      }
      console.warn(error.message);
    },
    [onAccessControlError],
  );

  const onVideoError = React.useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      // TODO: handleError(...)
      console.log('video error', event);
      handleError(new Error('Generic video error'));
    },
    [handleError],
  );

  return (
    <video
      className={styling.media.video({
        size: fullscreen ? 'fullscreen' : objectFit,
      })}
      loop={loop}
      aria-label={title ?? 'Video player'}
      role="video"
      autoPlay={autoPlay}
      width="100%"
      height="100%"
      ref={ref}
      webkit-playsinline="true"
      playsInline
      muted={muted}
      poster={typeof poster === 'string' ? poster : undefined}
      onError={onVideoError}
    >
      {filteredSources?.map((source) => (
        <source key={source.src} src={source.src} type={source.mime!} />
      ))}
      {
        "Your browser doesn't support the HTML5 <code>video</code> tag, or the video format."
      }
    </video>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

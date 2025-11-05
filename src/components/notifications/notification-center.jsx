import { Bell, Check, Archive } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export function NotificationCenter() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { 
    notifications, 
    unreadCount, 
    loading,
    markAsRead,
    markAllAsRead,
    archiveNotification 
  } = useNotifications();

  const { permission, requestPermission, isSupported, isSubscribed } = usePushNotifications();

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    
    // Navigate to action URL if exists (check both root level and data object)
    const actionUrl = notification.action_url || notification.data?.action_url;
    if (actionUrl) {
      navigate(actionUrl);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent':
        return 'destructive';
      case 'high':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="group relative h-9 w-9 rounded-xl bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[inset_0_1px_4px_rgba(0,0,0,0.06),0_0_0_3px_rgba(255,107,53,0.08)] hover:bg-botkorp-orange/5 transition-all duration-200"
          >
            {/* Bell icon */}
            <Bell className={`h-4 w-4 transition-colors duration-200 ${unreadCount > 0 ? 'text-botkorp-orange' : 'text-gray-600 dark:text-gray-400 group-hover:text-botkorp-orange'}`} />
            
            {/* Unread badge - clean and minimal */}
            {unreadCount > 0 && (
              <div className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center">
                <Badge 
                  variant="destructive" 
                  className="h-4 w-4 flex items-center justify-center p-0 text-[9px] font-semibold rounded-full bg-red-500 text-white shadow-sm border border-white dark:border-botkorp-black-light"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-96 max-h-[500px] overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={markAllAsRead}
              >
                Mark all read
              </Button>
            )}
          </div>

          {/* Push notification permission banner */}
          {isSupported && !isSubscribed && (
            <div className="p-4 bg-primary/10 border-b">
              <div className="flex items-center gap-2 mb-2">
                <Bell className="h-4 w-4" />
                <p className="text-sm font-medium">Stay Updated!</p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Get instant alerts for bot issues, service updates, and important notifications
              </p>
              <Button 
                size="sm" 
                onClick={async () => {
                  const success = await requestPermission();
                  if (success) {
                    toast({
                      title: 'Notifications Enabled! 🔔',
                      description: 'You\'ll now receive push notifications for important updates',
                    });
                  }
                }}
                className="w-full"
              >
                Enable Push Notifications
              </Button>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No notifications
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-accent cursor-pointer transition-colors ${
                    !notification.is_read ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {!notification.is_read && (
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        )}
                        <h4 className="font-medium text-sm truncate">
                          {notification.title}
                        </h4>
                        <Badge 
                          variant={getPriorityColor(notification.priority)}
                          className="text-xs"
                        >
                          {notification.priority}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!notification.is_read && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveNotification(notification.id);
                        }}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

